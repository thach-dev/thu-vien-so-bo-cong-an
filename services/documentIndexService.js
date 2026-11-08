
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

// Số lần thử lại khi Gemini gặp lỗi.
const MAX_EMBEDDING_RETRIES = 6;

// Nghỉ giữa các nhóm embedding.
const BATCH_DELAY = 1000;

// =====================================================
// HÀM TIỆN ÍCH
// =====================================================

const sleep = (ms) => {
    return new Promise((resolve) =>
        setTimeout(resolve, ms)
    );
};

// =====================================================
// 1. NHẬN DIỆN LỖI QUOTA GEMINI
// =====================================================

const getGeminiRetryDelay = (error, attempt) => {
    const message = String(
        error?.message || ""
    );

    // Đọc retryDelay từ JSON của Gemini.
    const retryDelayMatch = message.match(
        /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/
    );

    if (retryDelayMatch) {
        return (
            Math.ceil(
                Number(retryDelayMatch[1]) * 1000
            ) + 2000
        );
    }

    // Một số lỗi trả về dạng:
    // Please retry in 10.5s
    const retryMatch = message.match(
        /retry in\s+(\d+(?:\.\d+)?)s/i
    );

    if (retryMatch) {
        return (
            Math.ceil(
                Number(retryMatch[1]) * 1000
            ) + 2000
        );
    }

    // Nếu không có thời gian cụ thể,
    // sử dụng exponential backoff.
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
// 2. CHIA NỘI DUNG THÀNH CÁC ĐOẠN
// =====================================================

const splitTextIntoChunks = (text) => {
    if (!text || !String(text).trim()) {
        return [];
    }

    const cleanText = String(text)
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
// 3. TẠO EMBEDDING CÓ TỰ ĐỘNG THỬ LẠI
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

            if (
                !Array.isArray(embedding) ||
                embedding.length !== 768
            ) {
                throw new Error(
                    "Embedding phải có đúng 768 chiều."
                );
            }

            return embedding;

        } catch (error) {
            lastError = error;

            console.error(
                `Embedding lỗi lần ${attempt}/${MAX_EMBEDDING_RETRIES}:`,
                error.message
            );

            // Không thử lại nếu lỗi không thể khắc phục
            // bằng cách chờ.
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
                `Gemini đang giới hạn quota. Tự động chờ ${Math.ceil(delay / 1000)} giây...`
            );

            await sleep(delay);
        }
    }

    throw lastError;
};

// =====================================================
// 4. LẤY CÁC ĐOẠN ĐÃ LẬP CHỈ MỤC
// =====================================================

const getExistingChunks = async (documentId) => {
    const {
        data,
        error,
    } = await supabase
        .from("document_chunks")
        .select(
            "chunk_index, content, embedding"
        )
        .eq("document_id", documentId);

    if (error) {
        throw new Error(
            `Không thể kiểm tra chỉ mục cũ: ${error.message}`
        );
    }

    return data || [];
};

// =====================================================
// 5. LƯU TỪNG ĐOẠN VÀO SUPABASE
// =====================================================

const saveDocumentChunk = async (chunkData) => {
    const {
        error,
    } = await supabase
        .from("document_chunks")
        .upsert(
            chunkData,
            {
                onConflict:
                    "document_id,chunk_index",
            }
        );

    if (error) {
        throw new Error(
            `Không thể lưu đoạn ${chunkData.chunk_index}: ${error.message}`
        );
    }
};

// =====================================================
// 6. LẬP CHỈ MỤC MỘT TÀI LIỆU
// =====================================================

const indexApprovedDocument = async (
    documentId
) => {
    if (!documentId) {
        throw new Error("Thiếu documentId.");
    }

    // Chỉ xử lý tài liệu đã duyệt.
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

    // Chưa hỗ trợ tài liệu LINK.
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

    // Chia đoạn.
    const chunks =
        splitTextIntoChunks(documentText);

    if (!chunks.length) {
        throw new Error(
            "Không tìm thấy nội dung để lập chỉ mục."
        );
    }

    console.log(
        `Tổng số đoạn cần xử lý: ${chunks.length}`
    );

    // Lấy dữ liệu đã lập chỉ mục trước đó.
    const existingChunks =
        await getExistingChunks(document.id);

    const existingMap = new Map();

    for (const item of existingChunks) {
        existingMap.set(
            item.chunk_index,
            item
        );
    }

    let reusedChunks = 0;
    let generatedChunks = 0;

    // Xử lý từng nhóm.
    for (
        let batchStart = 0;
        batchStart < chunks.length;
        batchStart += EMBEDDING_BATCH_SIZE
    ) {
        const batch = chunks.slice(
            batchStart,
            batchStart + EMBEDDING_BATCH_SIZE
        );

        console.log(
            `Đang xử lý đoạn ${batchStart + 1} đến ${batchStart + batch.length}/${chunks.length}`
        );

        for (let i = 0; i < batch.length; i++) {
            const chunkIndex = batchStart + i;

            const content = batch[i];

            const existing =
                existingMap.get(chunkIndex);

            // Nếu nội dung không thay đổi và đã có
            // embedding thì không tạo lại.
            if (
                existing &&
                existing.content === content &&
                existing.embedding !== null
            ) {
                reusedChunks++;

                console.log(
                    `Bỏ qua đoạn ${chunkIndex + 1}: đã có embedding.`
                );

                continue;
            }

            // Tạo embedding.
            const embedding =
                await createEmbeddingWithRetry(
                    content,
                    document.title
                );

            // Lưu ngay từng đoạn.
            await saveDocumentChunk({
                document_id: document.id,
                document_title: document.title,
                chunk_index: chunkIndex,
                page_number: null,
                content,
                embedding:
                    `[${embedding.join(",")}]`,
            });

            generatedChunks++;

            console.log(
                `Đã lưu đoạn ${chunkIndex + 1}/${chunks.length}`
            );
        }

        // Nghỉ giữa các nhóm.
        if (
            batchStart + EMBEDDING_BATCH_SIZE <
            chunks.length
        ) {
            await sleep(BATCH_DELAY);
        }
    }

    // Chỉ xóa các đoạn cũ vượt quá số đoạn hiện tại
    // sau khi lập chỉ mục hoàn tất.
    const {
        error: cleanupError,
    } = await supabase
        .from("document_chunks")
        .delete()
        .eq("document_id", document.id)
        .gte("chunk_index", chunks.length);

    if (cleanupError) {
        throw new Error(
            `Không thể dọn đoạn cũ: ${cleanupError.message}`
        );
    }

    console.log(
        `Hoàn tất lập chỉ mục: ${document.title}`
    );

    return {
        success: true,
        documentId: document.id,
        documentTitle: document.title,
        totalChunks: chunks.length,
        generatedChunks,
        reusedChunks,
    };
};

// =====================================================
// 7. LẤY DANH SÁCH TÀI LIỆU ĐÃ DUYỆT
// =====================================================

const getApprovedDocumentsToIndex = async (
    limit = 10
) => {
    const safeLimit = Math.min(
        Math.max(Number(limit) || 10, 1),
        50
    );

    const {
        data,
        error,
    } = await supabase
        .from("documents")
        .select(
            "id, title, source_type"
        )
        .eq("status", "APPROVED")
        .order("created_at", {
            ascending: true,
        })
        .limit(safeLimit);

    if (error) {
        throw new Error(
            `Không thể lấy danh sách tài liệu: ${error.message}`
        );
    }

    return data || [];
};

// =====================================================
// 8. LẬP CHỈ MỤC NHIỀU TÀI LIỆU
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
        success: true,
        total: documents.length,
        results,
    };
};

// =====================================================
// 9. TÌM KIẾM NỘI DUNG LIÊN QUAN
// =====================================================

const searchRelevantChunks = async (
    question,
    limit = 15
) => {
    if (
        !question ||
        !String(question).trim()
    ) {
        throw new Error(
            "Vui lòng nhập câu hỏi tìm kiếm."
        );
    }

    const safeLimit = Math.min(
        Math.max(
            Number(limit) || 15,
            1
        ),
        MAX_SEARCH_RESULTS
    );

    console.log(
        "Bắt đầu tìm kiếm nội dung thư viện:",
        question
    );

    // Tạo embedding cho câu hỏi.
    const queryEmbedding =
        await generateQueryEmbedding(
            String(question).trim()
        );

    if (
        !Array.isArray(queryEmbedding) ||
        queryEmbedding.length !== 768
    ) {
        throw new Error(
            "Vector câu hỏi không đúng 768 chiều."
        );
    }

    // Tìm kiếm vector trong Supabase.
    const {
        data,
        error,
    } = await supabase.rpc(
        "match_document_chunks",
        {
            query_embedding:
                `[${queryEmbedding.join(",")}]`,

            match_count: safeLimit,

            match_threshold: 0.25,
        }
    );

    if (error) {
        console.error(
            "SEARCH RELEVANT CHUNKS ERROR:",
            error
        );

        throw new Error(
            `Không thể tìm kiếm nội dung tài liệu: ${error.message}`
        );
    }

    const results = data || [];

    console.log(
        `Tìm thấy ${results.length} đoạn tài liệu liên quan.`
    );

    return results;
};

// =====================================================
// 10. EXPORT
// =====================================================

module.exports = {
    splitTextIntoChunks,
    indexApprovedDocument,
    getApprovedDocumentsToIndex,
    indexNextApprovedDocuments,
    searchRelevantChunks,
};
