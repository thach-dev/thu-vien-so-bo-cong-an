
const supabase = require("../supabase");

const {
    extractDocumentText,
} = require("./documentParser");

const {
    generateDocumentEmbedding,
    generateQueryEmbedding,
} = require("./embeddingService");

// =====================================================
// CẤU HÌNH
// =====================================================

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 180;

const EMBEDDING_BATCH_SIZE = 5;

const MAX_SEARCH_RESULTS = 30;

const MIN_SIMILARITY = 0.25;

const MAX_EMBEDDING_RETRIES = 6;

const BATCH_DELAY = 1000;

const DOCUMENT_PAGE_SIZE = 100;

const ID_BATCH_SIZE = 100;

const EMBEDDING_DIMENSIONS = 768;

// =====================================================
// 1. HÀM TIỆN ÍCH
// =====================================================

const sleep = (ms) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};

const isValidText = (value) => {
    return (
        typeof value === "string" &&
        value.trim().length > 0
    );
};

// =====================================================
// 2. NHẬN DIỆN LỖI QUOTA GEMINI
// =====================================================

const getGeminiRetryDelay = (error, attempt) => {
    const message = String(error?.message || "");

    const retryDelayMatch = message.match(
        /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/
    );

    if (retryDelayMatch) {
        return (
            Math.ceil(Number(retryDelayMatch[1]) * 1000) +
            2000
        );
    }

    const retryMatch = message.match(
        /retry in\s+(\d+(?:\.\d+)?)s/i
    );

    if (retryMatch) {
        return (
            Math.ceil(Number(retryMatch[1]) * 1000) +
            2000
        );
    }

    return Math.min(
        5000 * Math.pow(2, attempt - 1),
        60000
    );
};

const isRetryableGeminiError = (error) => {
    const message = String(
        error?.message || ""
    ).toLowerCase();

    const status = Number(
        error?.status ||
        error?.code ||
        0
    );

    return (
        status === 429 ||
        status === 500 ||
        status === 503 ||
        status === 504 ||
        message.includes("429") ||
        message.includes("quota") ||
        message.includes("resource_exhausted") ||
        message.includes("rate limit") ||
        message.includes("503") ||
        message.includes("504")
    );
};

// =====================================================
// 3. CHUẨN HÓA EMBEDDING
// =====================================================

const parseEmbedding = (embedding) => {
    if (
        embedding === null ||
        embedding === undefined
    ) {
        return null;
    }

    try {
        let result = embedding;

        if (typeof result === "string") {
            result = JSON.parse(result);
        }

        if (!Array.isArray(result)) {
            return null;
        }

        if (result.length !== EMBEDDING_DIMENSIONS) {
            return null;
        }

        const vector = result.map(Number);

        if (
            vector.some(
                (value) => !Number.isFinite(value)
            )
        ) {
            return null;
        }

        return vector;

    } catch (error) {
        return null;
    }
};

// =====================================================
// 4. KIỂM TRA DỮ LIỆU ĐÃ LẬP CHỈ MỤC
// =====================================================

const isValidIndexedDocument = (document) => {
    if (!document) {
        return false;
    }

    const chunks = document.chunks;

    if (!Array.isArray(chunks) || !chunks.length) {
        return false;
    }

    if (
        Number(document.total_chunks) !== chunks.length
    ) {
        return false;
    }

    return chunks.every((chunk) => {
        if (!chunk || !isValidText(chunk.content)) {
            return false;
        }

        return Boolean(
            parseEmbedding(chunk.embedding)
        );
    });
};

// =====================================================
// 5. TÍNH COSINE SIMILARITY
// =====================================================

const cosineSimilarity = (vectorA, vectorB) => {
    if (
        !Array.isArray(vectorA) ||
        !Array.isArray(vectorB) ||
        vectorA.length !== vectorB.length ||
        vectorA.length === 0
    ) {
        return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
        dotProduct += vectorA[i] * vectorB[i];

        normA += vectorA[i] * vectorA[i];

        normB += vectorB[i] * vectorB[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (
        Math.sqrt(normA) * Math.sqrt(normB)
    );
};

// =====================================================
// 6. CHIA NỘI DUNG THÀNH CÁC ĐOẠN
// =====================================================

const splitTextIntoChunks = (text) => {
    if (!text || !String(text).trim()) {
        return [];
    }

    const cleanText = String(text)
        .normalize("NFC")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const chunks = [];

    let start = 0;

    while (start < cleanText.length) {
        let end = Math.min(
            start + CHUNK_SIZE,
            cleanText.length
        );

        if (end < cleanText.length) {
            const searchStart =
                start + Math.floor(CHUNK_SIZE * 0.7);

            const segment = cleanText.slice(
                searchStart,
                end
            );

            const paragraphBreak =
                segment.lastIndexOf("\n\n");

            const sentenceBreak = Math.max(
                segment.lastIndexOf(". "),
                segment.lastIndexOf("? "),
                segment.lastIndexOf("! ")
            );

            const breakPosition = Math.max(
                paragraphBreak >= 0
                    ? paragraphBreak
                    : -1,

                sentenceBreak >= 0
                    ? sentenceBreak
                    : -1
            );

            if (breakPosition >= 0) {
                end =
                    searchStart +
                    breakPosition +
                    1;
            }
        }

        const content = cleanText
            .slice(start, end)
            .trim();

        if (content) {
            chunks.push(content);
        }

        if (end >= cleanText.length) {
            break;
        }

        start = Math.max(
            end - CHUNK_OVERLAP,
            start + 1
        );
    }

    return chunks;
};

// =====================================================
// 7. TẠO EMBEDDING CÓ TỰ ĐỘNG THỬ LẠI
// =====================================================

const createEmbeddingWithRetry = async (
    content,
    title
) => {
    let lastError;

    for (
        let attempt = 1;
        attempt <= MAX_EMBEDDING_RETRIES;
        attempt++
    ) {
        try {
            const embedding =
                await generateDocumentEmbedding(
                    content,
                    title
                );

            const vector = parseEmbedding(embedding);

            if (!vector) {
                throw new Error(
                    `Embedding phải có đúng ${EMBEDDING_DIMENSIONS} chiều.`
                );
            }

            return vector;

        } catch (error) {
            lastError = error;

            console.error(
                `Embedding lỗi lần ${attempt}/${MAX_EMBEDDING_RETRIES}:`,
                error.message
            );

            if (
                !isRetryableGeminiError(error) ||
                attempt === MAX_EMBEDDING_RETRIES
            ) {
                throw error;
            }

            const delay = getGeminiRetryDelay(
                error,
                attempt
            );

            console.log(
                `Gemini giới hạn quota. Chờ ${Math.ceil(delay / 1000)} giây...`
            );

            await sleep(delay);
        }
    }

    throw lastError;
};

// =====================================================
// 8. LẤY DỮ LIỆU JSON CŨ
// =====================================================

const getExistingDocumentContent = async (
    documentId
) => {
    const {
        data,
        error,
    } = await supabase
        .from("document_contents")
        .select(
            "document_id, document_title, content, chunks, total_chunks"
        )
        .eq("document_id", documentId)
        .maybeSingle();

    if (error) {
        throw new Error(
            `Không thể đọc dữ liệu JSON cũ: ${error.message}`
        );
    }

    return data || null;
};

// =====================================================
// 9. LƯU TOÀN BỘ TÀI LIỆU VÀO MỘT HÀNG JSONB
// =====================================================

const saveDocumentContent = async ({
    documentId,
    documentTitle,
    content,
    chunks,
}) => {
    const payload = {
        document_id: documentId,

        document_title: documentTitle,

        content,

        chunks,

        total_chunks: chunks.length,

        updated_at: new Date().toISOString(),
    };

    const {
        error,
    } = await supabase
        .from("document_contents")
        .upsert(
            payload,
            {
                onConflict: "document_id",
            }
        );

    if (error) {
        throw new Error(
            `Không thể lưu nội dung JSON: ${error.message}`
        );
    }
};

// =====================================================
// 10. LẬP CHỈ MỤC MỘT TÀI LIỆU
// =====================================================

const indexApprovedDocument = async (
    documentId
) => {
    if (!documentId) {
        throw new Error("Thiếu documentId.");
    }

    // Chỉ lấy tài liệu đã duyệt.
    const {
        data: document,
        error: documentError,
    } = await supabase
        .from("documents")
        .select(
            "id, title, file_path, source_type, status"
        )
        .eq("id", documentId)
        .eq("status", "APPROVED")
        .single();

    if (documentError || !document) {
        throw new Error(
            "Không tìm thấy tài liệu hoặc tài liệu chưa được duyệt."
        );
    }

    // Chưa xử lý tài liệu LINK.
    if (document.source_type === "LINK") {
        return {
            success: false,
            skipped: true,
            documentId,
            reason:
                "Tài liệu LINK chưa được hỗ trợ lập chỉ mục.",
        };
    }

    if (!document.file_path) {
        throw new Error(
            "Tài liệu không có đường dẫn file."
        );
    }

    console.log(
        "Bắt đầu lập chỉ mục:",
        document.title
    );

    // Đọc file.
    const documentText =
        await extractDocumentText(
            document.file_path
        );

    if (
        !documentText ||
        !String(documentText).trim()
    ) {
        throw new Error(
            "Không trích xuất được nội dung tài liệu."
        );
    }

    // Chia nội dung.
    const textChunks =
        splitTextIntoChunks(documentText);

    if (!textChunks.length) {
        throw new Error(
            "Không tìm thấy nội dung để lập chỉ mục."
        );
    }

    console.log(
        `Tổng số đoạn cần xử lý: ${textChunks.length}`
    );

    // Đọc dữ liệu JSON cũ.
    const existingDocument =
        await getExistingDocumentContent(
            document.id
        );

    const existingChunks = Array.isArray(
        existingDocument?.chunks
    )
        ? existingDocument.chunks
        : [];

    const existingMap = new Map();

    for (const item of existingChunks) {
        const index = Number(item?.chunk_index);

        if (
            Number.isInteger(index) &&
            index >= 0
        ) {
            existingMap.set(index, item);
        }
    }

    const processedChunks = [];

    let reusedChunks = 0;
    let generatedChunks = 0;

    // Xử lý lần lượt từng nhóm.
    for (
        let batchStart = 0;
        batchStart < textChunks.length;
        batchStart += EMBEDDING_BATCH_SIZE
    ) {
        const batch = textChunks.slice(
            batchStart,
            batchStart + EMBEDDING_BATCH_SIZE
        );

        console.log(
            `Đang xử lý đoạn ${batchStart + 1} đến ${batchStart + batch.length}/${textChunks.length}`
        );

        for (let i = 0; i < batch.length; i++) {
            const chunkIndex = batchStart + i;

            const chunkContent = batch[i];

            const existing =
                existingMap.get(chunkIndex);

            let embedding = null;

            // Tái sử dụng embedding nếu nội dung không đổi.
            if (
                existing &&
                existing.content === chunkContent
            ) {
                embedding = parseEmbedding(
                    existing.embedding
                );
            }

            if (embedding) {
                reusedChunks++;

            } else {
                embedding =
                    await createEmbeddingWithRetry(
                        chunkContent,
                        document.title
                    );

                generatedChunks++;
            }

            processedChunks.push({
                chunk_index: chunkIndex,

                page_number:
                    existing?.page_number ?? null,

                content: chunkContent,

                embedding,
            });
        }

        if (
            batchStart + EMBEDDING_BATCH_SIZE <
            textChunks.length
        ) {
            await sleep(BATCH_DELAY);
        }
    }

    // Ghép toàn bộ nội dung.
    const fullContent = processedChunks
        .map((item) => item.content)
        .join("\n\n");

    // Ghi một lần vào Supabase.
    await saveDocumentContent({
        documentId: document.id,
        documentTitle: document.title,
        content: fullContent,
        chunks: processedChunks,
    });

    console.log(
        `Hoàn tất lập chỉ mục JSON: ${document.title}`
    );

    return {
        success: true,

        storage: "document_contents",

        documentId: document.id,

        documentTitle: document.title,

        totalChunks: processedChunks.length,

        totalRows: 1,

        generatedChunks,

        reusedChunks,
    };
};

// =====================================================
// 11. LẤY TÀI LIỆU ĐÃ DUYỆT CHƯA LẬP CHỈ MỤC
// =====================================================

const getApprovedDocumentsToIndex = async (
    limit = 10
) => {
    const safeLimit = Math.min(
        Math.max(Number(limit) || 10, 1),
        50
    );

    const pendingDocuments = [];

    let from = 0;

    // Đọc từng trang tài liệu.
    while (pendingDocuments.length < safeLimit) {
        const to = from + DOCUMENT_PAGE_SIZE - 1;

        const {
            data: documents,
            error: documentError,
        } = await supabase
            .from("documents")
            .select(
                "id, title, source_type, file_path"
            )
            .eq("status", "APPROVED")
            .order("created_at", {
                ascending: true,
            })
            .range(from, to);

        if (documentError) {
            throw new Error(
                `Không thể lấy danh sách tài liệu: ${documentError.message}`
            );
        }

        const rows = documents || [];

        if (!rows.length) {
            break;
        }

        // Chỉ xử lý tài liệu có file.
        const eligibleDocuments = rows.filter(
            (document) => (
                document.source_type !== "LINK" &&
                Boolean(document.file_path)
            )
        );

        if (eligibleDocuments.length) {
            const ids = eligibleDocuments.map(
                (item) => item.id
            );

            const {
                data: indexedRows,
                error: indexedError,
            } = await supabase
                .from("document_contents")
                .select(
                    "document_id, total_chunks, chunks"
                )
                .in("document_id", ids);

            if (indexedError) {
                throw new Error(
                    `Không thể kiểm tra dữ liệu đã lập chỉ mục: ${indexedError.message}`
                );
            }

            const indexedMap = new Map(
                (indexedRows || []).map((item) => [
                    item.document_id,
                    item,
                ])
            );

            for (const document of eligibleDocuments) {
                const indexed = indexedMap.get(
                    document.id
                );

                // Bỏ qua tài liệu đã có đủ embedding hợp lệ.
                if (isValidIndexedDocument(indexed)) {
                    continue;
                }

                pendingDocuments.push(document);

                if (
                    pendingDocuments.length >= safeLimit
                ) {
                    break;
                }
            }
        }

        if (rows.length < DOCUMENT_PAGE_SIZE) {
            break;
        }

        from += DOCUMENT_PAGE_SIZE;
    }

    return pendingDocuments;
};

// =====================================================
// 12. LẬP CHỈ MỤC NHIỀU TÀI LIỆU
// =====================================================

const indexNextApprovedDocuments = async (
    limit = 1
) => {
    const documents =
        await getApprovedDocumentsToIndex(limit);

    const results = [];

    for (const document of documents) {
        try {
            const result =
                await indexApprovedDocument(
                    document.id
                );

            results.push(result);

        } catch (error) {
            console.error(
                `Lỗi lập chỉ mục ${document.title}:`,
                error.message
            );

            results.push({
                success: false,
                documentId: document.id,
                documentTitle: document.title,
                error: error.message,
            });
        }
    }

    return {
        success: results.every(
            (item) => item.success || item.skipped
        ),

        total: documents.length,

        successful: results.filter(
            (item) => item.success
        ).length,

        failed: results.filter(
            (item) => !item.success && !item.skipped
        ).length,

        results,
    };
};

// =====================================================
// 13. LẤY TOÀN BỘ ID TÀI LIỆU ĐÃ DUYỆT
// =====================================================

const getAllApprovedDocumentIds = async () => {
    const allDocuments = [];

    let from = 0;

    while (true) {
        const to = from + DOCUMENT_PAGE_SIZE - 1;

        const {
            data,
            error,
        } = await supabase
            .from("documents")
            .select("id, title")
            .eq("status", "APPROVED")
            .order("id", {
                ascending: true,
            })
            .range(from, to);

        if (error) {
            throw new Error(
                `Không thể lấy danh sách tài liệu đã duyệt: ${error.message}`
            );
        }

        const rows = data || [];

        allDocuments.push(...rows);

        if (rows.length < DOCUMENT_PAGE_SIZE) {
            break;
        }

        from += DOCUMENT_PAGE_SIZE;
    }

    return allDocuments;
};

// =====================================================
// 14. TÌM KIẾM NỘI DUNG TRONG DOCUMENT_CONTENTS
// =====================================================

const searchRelevantChunks = async (
    question,
    limit = 15
) => {
    if (!isValidText(question)) {
        throw new Error(
            "Vui lòng nhập câu hỏi tìm kiếm."
        );
    }

    const safeLimit = Math.min(
        Math.max(Number(limit) || 15, 1),
        MAX_SEARCH_RESULTS
    );

    console.log(
        "Bắt đầu tìm kiếm thư viện JSON:",
        question
    );

    // 1. Tạo embedding câu hỏi.
    const queryEmbedding =
        await generateQueryEmbedding(
            String(question).trim()
        );

    const queryVector = parseEmbedding(
        queryEmbedding
    );

    if (!queryVector) {
        throw new Error(
            `Vector câu hỏi không đúng ${EMBEDDING_DIMENSIONS} chiều.`
        );
    }

    // 2. Lấy danh sách tài liệu đã duyệt.
    const approvedDocuments =
        await getAllApprovedDocumentIds();

    if (!approvedDocuments.length) {
        return [];
    }

    const approvedMap = new Map(
        approvedDocuments.map((item) => [
            item.id,
            item.title,
        ])
    );

    const approvedIds = approvedDocuments.map(
        (item) => item.id
    );

    const results = [];

    // 3. Đọc JSONB theo từng nhóm ID.
    for (
        let i = 0;
        i < approvedIds.length;
        i += ID_BATCH_SIZE
    ) {
        const ids = approvedIds.slice(
            i,
            i + ID_BATCH_SIZE
        );

        const {
            data,
            error,
        } = await supabase
            .from("document_contents")
            .select(
                "document_id, document_title, chunks"
            )
            .in("document_id", ids);

        if (error) {
            throw new Error(
                `Không thể đọc dữ liệu JSON thư viện: ${error.message}`
            );
        }

        // 4. Tính similarity cho từng chunk.
        for (const document of data || []) {
            if (
                !approvedMap.has(document.document_id)
            ) {
                continue;
            }

            const chunks = Array.isArray(
                document.chunks
            )
                ? document.chunks
                : [];

            for (const chunk of chunks) {
                if (
                    !chunk ||
                    !isValidText(chunk.content)
                ) {
                    continue;
                }

                const embedding = parseEmbedding(
                    chunk.embedding
                );

                if (!embedding) {
                    continue;
                }

                const similarity = cosineSimilarity(
                    queryVector,
                    embedding
                );

                if (similarity < MIN_SIMILARITY) {
                    continue;
                }

                results.push({
                    document_id: document.document_id,

                    document_title:
                        document.document_title ||
                        approvedMap.get(
                            document.document_id
                        ),

                    chunk_index: chunk.chunk_index,

                    page_number:
                        chunk.page_number ?? null,

                    content: chunk.content,

                    similarity,
                });
            }
        }
    }

    // 5. Sắp xếp độ liên quan giảm dần.
    results.sort(
        (a, b) => b.similarity - a.similarity
    );

    const finalResults = results.slice(
        0,
        safeLimit
    );

    console.log(
        `Tìm thấy ${finalResults.length} đoạn JSON liên quan.`
    );

    return finalResults;
};

// =====================================================
// 15. EXPORT
// =====================================================

module.exports = {
    splitTextIntoChunks,

    indexApprovedDocument,

    getApprovedDocumentsToIndex,

    indexNextApprovedDocuments,

    getAllApprovedDocumentIds,

    searchRelevantChunks,
};
