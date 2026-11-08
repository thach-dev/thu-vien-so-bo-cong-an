
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

// =====================================================
// 1. CHIA NỘI DUNG THÀNH CÁC ĐOẠN NHỎ
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

        // Ưu tiên cắt tại cuối đoạn hoặc cuối câu.
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
                end = searchStart + breakPosition + 1;
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
// 2. TẠO EMBEDDING CÓ THỬ LẠI
// =====================================================

const createEmbeddingWithRetry = async (
    content,
    title
) => {
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await generateDocumentEmbedding(
                content,
                title
            );
        } catch (error) {
            lastError = error;

            console.error(
                `Embedding lỗi lần ${attempt}/3:`,
                error.message
            );

            if (attempt < 3) {
                await new Promise((resolve) =>
                    setTimeout(resolve, attempt * 2000)
                );
            }
        }
    }

    throw lastError;
};

// =====================================================
// 3. LẬP CHỈ MỤC MỘT TÀI LIỆU ĐÃ DUYỆT
// =====================================================

const indexApprovedDocument = async (documentId) => {
    if (!documentId) {
        throw new Error("Thiếu documentId.");
    }

    // Chỉ lấy tài liệu APPROVED.
    const {
        data: document,
        error: documentError,
    } = await supabase
        .from("documents")
        .select("id, title, file_path, source_type, status")
        .eq("id", documentId)
        .eq("status", "APPROVED")
        .single();

    if (documentError || !document) {
        throw new Error(
            "Không tìm thấy tài liệu hoặc tài liệu chưa được duyệt."
        );
    }

    // Chưa xử lý tài liệu dạng LINK.
    if (document.source_type === "LINK") {
        return {
            success: false,
            skipped: true,
            documentId,
            reason:
                "Tài liệu dạng LINK cần bộ đọc URL an toàn riêng.",
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

    // Đọc nội dung tài liệu.
    const documentText = await extractDocumentText(
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

    // Chia nội dung thành các đoạn.
    const chunks = splitTextIntoChunks(
        documentText
    );

    if (!chunks.length) {
        throw new Error(
            "Không tìm thấy nội dung để lập chỉ mục."
        );
    }

    console.log(
        `Tài liệu ${document.title}: ${chunks.length} đoạn.`
    );

    // Tạo embedding trước khi xóa dữ liệu cũ.
    const indexedChunks = [];

    for (
        let batchStart = 0;
        batchStart < chunks.length;
        batchStart += EMBEDDING_BATCH_SIZE
    ) {
        const batch = chunks.slice(
            batchStart,
            batchStart + EMBEDDING_BATCH_SIZE
        );

        for (let i = 0; i < batch.length; i++) {
            const chunkIndex = batchStart + i;
            const content = batch[i];

            const embedding =
                await createEmbeddingWithRetry(
                    content,
                    document.title
                );

            if (
                !Array.isArray(embedding) ||
                embedding.length !== 768
            ) {
                throw new Error(
                    "Embedding phải có đúng 768 chiều."
                );
            }

            indexedChunks.push({
                document_id: document.id,
                document_title: document.title,
                chunk_index: chunkIndex,
                page_number: null,
                content,
                embedding: `[${embedding.join(",")}]`,
            });
        }

        // Nghỉ ngắn giữa các nhóm.
        if (
            batchStart + EMBEDDING_BATCH_SIZE <
            chunks.length
        ) {
            await new Promise((resolve) =>
                setTimeout(resolve, 1000)
            );
        }
    }

    // Chỉ xóa dữ liệu cũ sau khi tạo đủ embedding.
    const {
        error: deleteError,
    } = await supabase
        .from("document_chunks")
        .delete()
        .eq("document_id", document.id);

    if (deleteError) {
        throw new Error(
            `Không thể xóa chỉ mục cũ: ${deleteError.message}`
        );
    }

    // Lưu dữ liệu theo từng lô.
    for (
        let start = 0;
        start < indexedChunks.length;
        start += 50
    ) {
        const batch = indexedChunks.slice(
            start,
            start + 50
        );

        const {
            error: insertError,
        } = await supabase
            .from("document_chunks")
            .insert(batch);

        if (insertError) {
            throw new Error(
                `Không thể lưu đoạn tài liệu: ${insertError.message}`
            );
        }
    }

    console.log(
        `Đã lập chỉ mục ${document.title}: ${indexedChunks.length} đoạn.`
    );

    return {
        success: true,
        documentId: document.id,
        documentTitle: document.title,
        totalChunks: indexedChunks.length,
    };
};

// =====================================================
// 4. LẤY DANH SÁCH TÀI LIỆU ĐÃ DUYỆT
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
        .select("id, title, source_type")
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
// 5. LẬP CHỈ MỤC MỘT LÔ TÀI LIỆU
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
                await indexApprovedDocument(document.id);

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
// 6. TÌM KIẾM NỘI DUNG LIÊN QUAN TRONG TOÀN BỘ THƯ VIỆN
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

    // Bước 1: Chuyển câu hỏi thành vector embedding.
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

    // Bước 2: Tìm các đoạn tài liệu tương đồng trong Supabase.
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

    // RPC trả về các đoạn phù hợp.
    const results = data || [];

    console.log(
        `Tìm thấy ${results.length} đoạn tài liệu liên quan.`
    );

    return results;
};

// =====================================================
// 7. EXPORT
// =====================================================

module.exports = {
    splitTextIntoChunks,
    indexApprovedDocument,
    getApprovedDocumentsToIndex,
    indexNextApprovedDocuments,
    searchRelevantChunks,
};
