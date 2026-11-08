
const supabase = require("../supabase");

const {
  indexApprovedDocument,
} = require("../services/documentIndexService");

// =====================================================
// CẤU HÌNH
// =====================================================

const BUCKET_NAME = "documents";

const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
];

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

// =====================================================
// GIẢI MÃ TÊN FILE TIẾNG VIỆT
// =====================================================

const decodeFileName = (fileName) => {
  if (!fileName) return "";

  try {
    return Buffer.from(fileName, "latin1").toString("utf8");
  } catch (error) {
    console.error("Decode filename error:", error);
    return fileName;
  }
};

// =====================================================
// 1. UPLOAD TÀI LIỆU
// =====================================================

const uploadDocument = async (req, res) => {
  let uploadedFileName = null;

  try {
    const {
      uploader_id,
      title,
      description,
      category,
      original_author,
      source_citation,
      license_confirmed,
    } = req.body;

    const file = req.file;

    console.log("=================================");
    console.log("UPLOAD DOCUMENT");
    console.log("Uploader ID:", uploader_id);
    console.log("Title:", title);
    console.log("Original File:", file?.originalname);
    console.log("Decoded File:", decodeFileName(file?.originalname));
    console.log("Mimetype:", file?.mimetype);
    console.log("Size:", file?.size);
    console.log("=================================");

    if (!uploader_id || !title || !file) {
      return res.status(400).json({
        message: "Thiếu dữ liệu bắt buộc: uploader_id, title hoặc file.",
      });
    }

    if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
      return res.status(400).json({
        message: "Không đọc được nội dung file.",
      });
    }

    const isLicenseConfirmed =
      license_confirmed === true ||
      license_confirmed === "true";

    if (!isLicenseConfirmed) {
      return res.status(400).json({
        message: "Bạn phải đồng ý cam kết tuân thủ quyền sở hữu trí tuệ.",
      });
    }

    const {
      data: uploader,
      error: uploaderError,
    } = await supabase
      .from("users")
      .select("id, username, role")
      .eq("id", uploader_id)
      .maybeSingle();

    if (uploaderError) {
      return res.status(500).json({
        message: "Không thể kiểm tra người đăng tài liệu.",
        error: uploaderError.message,
      });
    }

    if (!uploader) {
      return res.status(400).json({
        message: "Tài khoản đăng tài liệu không tồn tại.",
        uploader_id,
      });
    }

    const originalName = decodeFileName(file.originalname || "");

    const fileExt = originalName
      .split(".")
      .pop()
      .toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
      return res.status(400).json({
        message: "Định dạng file không được hỗ trợ.",
        allowedExtensions: ALLOWED_EXTENSIONS,
      });
    }

    if (
      file.mimetype &&
      !ALLOWED_MIME_TYPES.includes(file.mimetype)
    ) {
      return res.status(400).json({
        message: "Loại file không được hỗ trợ.",
        mimetype: file.mimetype,
      });
    }

    const fileName =
      `${Date.now()}_${Math.random().toString(36).substring(2, 10)}.${fileExt}`;

    uploadedFileName = fileName;

    const {
      data: storageData,
      error: storageError,
    } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype || "application/octet-stream",
        upsert: false,
      });

    if (storageError) {
      console.error("Storage upload error:", storageError);

      return res.status(500).json({
        message: "Không thể lưu tệp lên Storage.",
        error: storageError.message,
      });
    }

    const {
      data: urlData,
    } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    const publicUrl = urlData?.publicUrl;

    if (!publicUrl) {
      await supabase.storage.from(BUCKET_NAME).remove([fileName]);

      return res.status(500).json({
        message: "Không thể lấy URL của file.",
      });
    }

    const {
      data: newDoc,
      error: dbError,
    } = await supabase
      .from("documents")
      .insert({
        uploader_id: uploader.id,
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        category: category || "LECTURE_NOTE",
        file_path: publicUrl,
        original_author: original_author
          ? String(original_author).trim()
          : null,
        source_citation: source_citation
          ? String(source_citation).trim()
          : null,
        license_confirmed: true,
        status: "PENDING",
        source_type: "FILE",
      })
      .select("*")
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError);

      await supabase.storage.from(BUCKET_NAME).remove([fileName]);

      return res.status(500).json({
        message: "Không thể lưu tài liệu vào CSDL.",
        error: dbError.message,
        code: dbError.code,
        details: dbError.details,
      });
    }

    console.log("UPLOAD DOCUMENT SUCCESS:", newDoc.id);

    return res.status(201).json({
      message: "Đăng tải tài liệu thành công, đang chờ kiểm duyệt.",
      document: newDoc,
    });

  } catch (error) {
    console.error("UPLOAD SERVER ERROR:", error);

    if (uploadedFileName) {
      try {
        await supabase.storage
          .from(BUCKET_NAME)
          .remove([uploadedFileName]);
      } catch (rollbackError) {
        console.error("Storage rollback error:", rollbackError);
      }
    }

    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// 2. ĐĂNG SÁCH BẰNG LINK
// =====================================================

const submitBookByLink = async (req, res) => {
  try {
    const {
      uploader_id,
      title,
      description,
      category,
      original_author,
      source_citation,
      cover_image_url,
      reading_url,
      license_confirmed,
    } = req.body;

    if (!uploader_id || !title || !reading_url) {
      return res.status(400).json({
        message: "Vui lòng cung cấp người đăng, tên sách và đường dẫn đọc sách.",
      });
    }

    const isLicenseConfirmed =
      license_confirmed === true ||
      license_confirmed === "true";

    if (!isLicenseConfirmed) {
      return res.status(400).json({
        message: "Bạn phải đồng ý cam kết tuân thủ quyền sở hữu trí tuệ.",
      });
    }

    const isValidHttpUrl = (value) => {
      try {
        const parsedUrl = new URL(value);
        return ["http:", "https:"].includes(parsedUrl.protocol);
      } catch {
        return false;
      }
    };

    if (!isValidHttpUrl(reading_url)) {
      return res.status(400).json({
        message: "Đường dẫn đọc sách không hợp lệ.",
      });
    }

    if (cover_image_url && !isValidHttpUrl(cover_image_url)) {
      return res.status(400).json({
        message: "Đường dẫn ảnh bìa không hợp lệ.",
      });
    }

    const {
      data: uploader,
      error: uploaderError,
    } = await supabase
      .from("users")
      .select("id, username, role")
      .eq("id", uploader_id)
      .maybeSingle();

    if (uploaderError) {
      return res.status(500).json({
        message: "Không thể kiểm tra người đăng sách.",
        error: uploaderError.message,
      });
    }

    if (!uploader) {
      return res.status(400).json({
        message: "Tài khoản đăng sách không tồn tại.",
      });
    }

    const {
      data: newDoc,
      error: dbError,
    } = await supabase
      .from("documents")
      .insert({
        uploader_id: uploader.id,
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        category: category || "REFERENCE_BOOK",
        file_path: String(reading_url).trim(),
        original_author: original_author
          ? String(original_author).trim()
          : null,
        source_citation: source_citation
          ? String(source_citation).trim()
          : null,
        cover_image_url: cover_image_url
          ? String(cover_image_url).trim()
          : null,
        source_type: "LINK",
        license_confirmed: true,
        status: "PENDING",
      })
      .select("*")
      .single();

    if (dbError) {
      console.error("Insert book by link error:", dbError);

      return res.status(500).json({
        message: "Không thể lưu sách vào cơ sở dữ liệu.",
        error: dbError.message,
        code: dbError.code,
      });
    }

    return res.status(201).json({
      message: "Đăng sách thành công, đang chờ quản trị viên kiểm duyệt.",
      document: newDoc,
    });

  } catch (error) {
    console.error("Submit book by link error:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// 3. LẤY TÀI LIỆU ĐÃ DUYỆT
// =====================================================

const getApprovedDocuments = async (req, res) => {
  try {
    const {
      data: docs,
      error,
    } = await supabase
      .from("documents")
      .select("*, users:uploader_id (id, username, role)")
      .eq("status", "APPROVED")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        message: "Lỗi lấy danh sách tài liệu",
        error: error.message,
      });
    }

    return res.status(200).json({
      total: docs?.length || 0,
      documents: docs || [],
    });

  } catch (error) {
    console.error("Get approved documents error:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// 4. TÌM KIẾM TÀI LIỆU
// =====================================================

const searchDocuments = async (req, res) => {
  try {
    const {
      q,
      category,
      page = 1,
      limit = 20,
    } = req.query;

    const keyword = q ? String(q).trim() : "";

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);

    const limitNumber = Math.min(
      Math.max(parseInt(limit, 10) || 20, 1),
      100
    );

    const from = (pageNumber - 1) * limitNumber;
    const to = from + limitNumber - 1;

    let query = supabase
      .from("documents")
      .select("*, users:uploader_id (id, username, role)", {
        count: "exact",
      })
      .eq("status", "APPROVED")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (keyword) {
      query = query.or([
        `title.ilike.%${keyword}%`,
        `description.ilike.%${keyword}%`,
        `original_author.ilike.%${keyword}%`,
        `source_citation.ilike.%${keyword}%`,
      ].join(","));
    }

    if (category && category !== "ALL") {
      query = query.eq("category", category);
    }

    const {
      data: docs,
      error,
      count,
    } = await query;

    if (error) {
      return res.status(500).json({
        message: "Lỗi tìm kiếm tài liệu",
        error: error.message,
      });
    }

    const total = count || 0;

    return res.status(200).json({
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
      documents: docs || [],
    });

  } catch (error) {
    console.error("Search documents error:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// 5. LẤY TÀI LIỆU CHỜ DUYỆT
// =====================================================

const getPendingDocuments = async (req, res) => {
  try {
    const {
      data: docs,
      error,
    } = await supabase
      .from("documents")
      .select("*, users:uploader_id (id, username, role)")
      .eq("status", "PENDING")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        message: "Lỗi lấy danh sách chờ duyệt",
        error: error.message,
      });
    }

    return res.status(200).json({
      total: docs?.length || 0,
      documents: docs || [],
    });

  } catch (error) {
    console.error("Get pending documents error:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// 6. DUYỆT / TỪ CHỐI + TỰ ĐỘNG LẬP CHỈ MỤC AI
// =====================================================

const updateDocumentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Trạng thái chỉ nhận giá trị APPROVED hoặc REJECTED",
      });
    }

    const {
      data,
      error,
    } = await supabase
      .from("documents")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Update document status error:", error);

      return res.status(500).json({
        success: false,
        message: "Cập nhật trạng thái thất bại",
        error: error.message,
      });
    }

    if (status === "REJECTED") {
      return res.status(200).json({
        success: true,
        message: "Đã từ chối tài liệu.",
        document: data,
        indexing: {
          status: "SKIPPED",
          message: "Tài liệu bị từ chối nên không lập chỉ mục AI.",
        },
      });
    }

    // Chỉ lập chỉ mục khi tài liệu được duyệt
    console.log("DOCUMENT APPROVED - START AI INDEXING:", data.id);

    try {
      const indexResult = await indexApprovedDocument(data.id);

      if (indexResult?.skipped) {
        return res.status(200).json({
          success: true,
          message: "Duyệt tài liệu thành công.",
          document: data,
          indexing: {
            status: "SKIPPED",
            message: indexResult.reason,
          },
        });
      }

      return res.status(200).json({
        success: true,
        message: "Duyệt tài liệu và lập chỉ mục AI thành công.",
        document: data,
        indexing: {
          status: "COMPLETED",
          result: indexResult,
        },
      });

    } catch (indexError) {
      console.error("AI INDEXING ERROR:", indexError);

      return res.status(200).json({
        success: true,
        message: "Duyệt tài liệu thành công nhưng lập chỉ mục AI chưa hoàn tất.",
        document: data,
        indexing: {
          status: "FAILED",
          message: indexError.message,
        },
      });
    }

  } catch (error) {
    console.error("Update status server error:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// 7. LẤY DANH SÁCH CATEGORY
// =====================================================

const getDocumentCategories = async (req, res) => {
  try {
    const {
      data,
      error,
    } = await supabase
      .from("documents")
      .select("category")
      .eq("status", "APPROVED")
      .not("category", "is", null);

    if (error) {
      return res.status(500).json({
        message: "Lỗi lấy danh sách loại tài liệu",
        error: error.message,
      });
    }

    const categories = [
      ...new Set(
        (data || [])
          .map((item) => item.category)
          .filter(Boolean)
      ),
    ];

    return res.status(200).json({ categories });

  } catch (error) {
    console.error("Get categories error:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  uploadDocument,
  submitBookByLink,
  getApprovedDocuments,
  searchDocuments,
  getDocumentCategories,
  getPendingDocuments,
  updateDocumentStatus,
};
