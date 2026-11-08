
const supabase = require("../supabase");
const { extractDocumentText } = require("./documentParser");
const {
    generateDocumentEmbedding,
} = require("./embeddingService");

// Cấu hình chia đoạn
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 180;
const EMBEDDING_BATCH_SIZE = 5;

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
        let end = Math.min(start + CHUNK_SIZE, cleanText.length);

        // Cố gắng cắt ở cuối đoạn hoặc cuối câu.
        if (end < cleanText.length) {
            const searchStart = start + Math.floor(CHUNK_SIZE * 0.7);
            const segment = cleanText.slice(searchStart, end);

            const paragraphBreak = segment.lastIndexOf("\n\n");
            const sentenceBreak = Math.max(
                segment.lastIndexOf(". "),
                segment.lastIndexOf("? "),
                segment.lastIndexOf("! ")
            );

            const breakPosition = Math.max(
                paragraphBreak >= 0 ? paragraphBreak : -1,
                sentenceBreak >= 0 ? sentenceBreak : -1
            );

            if (breakPosition >= 0) {
                end = searchStart + breakPosition + 1;
            }
        }

        const content = cleanText.slice(start, end).trim();

        if (content) {
            chunks.push(content);
        }

        if (end >= cleanText.length) {
            break;
        }

        start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }

    return chunks;
};

// =====================================================
// 2. TẠO EMBEDDING CÓ THỬ LẠI
// =====================================================

const createEmbeddingWithRetry = async (content, title) => {
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await generateDocumentEmbedding(content, title);
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
// 3. LẬP CHỈ MỤC MỘT TÀI LIỆU
// =====================================================

const indexApprovedDocument = async (documentId) => {
    if (!documentId) {
        throw new Error("Thiếu documentId.");
    }

    // Chỉ lấy tài liệu đã được duyệt.
    const { data: document, error: documentError } = await supabase
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

    // Chưa xử lý URL sách bên ngoài ở phiên bản này.
    // Không tải URL tùy ý để tránh rủi ro SSRF.
    if (document.source_type === "LINK") {
        return {
            success: false,
            skipped: true,
            documentId,
            reason: "Tài liệu dạng LINK cần bộ đọc URL an toàn riêng.",
        };
    }

    if (!document.file_path) {
        throw new Error("Tài liệu không có đường dẫn file.");
    }

    console.log("Bắt đầu lập chỉ mục:", document.title);

    // Đọc nội dung file.
    const documentText = await extractDocumentText(
        document.file_path
    );

    if (!documentText || !documentText.trim()) {
        throw new Error("Không trích xuất được nội dung tài liệu.");
    }

    // Chia thành các đoạn.
    const chunks = splitTextIntoChunks(documentText);

    if (!chunks.length) {
        throw new Error("Không tìm thấy nội dung để lập chỉ mục.");
    }

    console.log(
        `Tài liệu ${document.title}: ${chunks.length} đoạn.`
    );

    // Tạo embedding trước khi xóa dữ liệu chỉ mục cũ.
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

            const embedding = await createEmbeddingWithRetry(
                content,
                document.title
            );

            indexedChunks.push({
                document_id: document.id,
                document_title: document.title,
                chunk_index: chunkIndex,
                page_number: null,
                content,
                // pgvector nhận vector theo định dạng chuỗi.
                embedding: `[${embedding.join(",")}]`,
            });
        }

        // Nghỉ ngắn giữa các nhóm để giảm áp lực API.
        if (batchStart + EMBEDDING_BATCH_SIZE < chunks.length) {
            await new Promise((resolve) =>
                setTimeout(resolve, 1000)
            );
        }
    }

    // Chỉ thay chỉ mục cũ sau khi đã tạo đủ embedding.
    const { error: deleteError } = await supabase
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
        const batch = indexedChunks.slice(start, start + 50);

        const { error: insertError } = await supabase
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

const getApprovedDocumentsToIndex = async (limit = 10) => {
    const safeLimit = Math.min(
        Math.max(Number(limit) || 10, 1),
        50
    );

    const { data, error } = await supabase
        .from("documents")
        .select("id, title, source_type")
        .eq("status", "APPROVED")
        .order("created_at", { ascending: true })
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

const indexNextApprovedDocuments = async (limit = 1) => {
    const documents = await getApprovedDocumentsToIndex(limit);

    const results = [];

    for (const document of documents) {
        try {
            const result = await indexApprovedDocument(document.id);
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

module.exports = {
    splitTextIntoChunks,
    indexApprovedDocument,
    getApprovedDocumentsToIndex,
    indexNextApprovedDocuments,
};
