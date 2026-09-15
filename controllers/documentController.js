
const supabase = require("../supabase");

// =====================================================
// CẤU HÌNH
// =====================================================

const BUCKET_NAME = "documents";

const ALLOWED_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx"
];

const ALLOWED_MIME_TYPES = [
  // PDF
  "application/pdf",

  // Word
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

  // PowerPoint
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",

  // Excel
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
];


// =====================================================
// 1. UPLOAD TÀI LIỆU
// =====================================================

const uploadDocument = async (req, res) => {
  try {
    const {
      uploader_id,
      title,
      description,
      category,
      original_author,
      source_citation,
      license_confirmed
    } = req.body;

    const file = req.file;

    console.log("=================================");
    console.log("UPLOAD DOCUMENT");
    console.log("Uploader:", uploader_id);
    console.log("Title:", title);
    console.log("File:", file?.originalname);
    console.log("Mimetype:", file?.mimetype);
    console.log("Bucket:", BUCKET_NAME);
    console.log("=================================");

    // -------------------------------------------------
    // Kiểm tra dữ liệu
    // -------------------------------------------------

    if (!uploader_id || !title || !file) {
      return res.status(400).json({
        message:
          "Thiếu dữ liệu bắt buộc: uploader_id, title hoặc file."
      });
    }

    // -------------------------------------------------
    // Kiểm tra bản quyền
    // -------------------------------------------------

    const isLicenseConfirmed =
      license_confirmed === true ||
      license_confirmed === "true";

    if (!isLicenseConfirmed) {
      return res.status(400).json({
        message:
          "Bạn phải đồng ý cam kết tuân thủ quyền sở hữu trí tuệ."
      });
    }

    // -------------------------------------------------
    // Lấy phần mở rộng
    // -------------------------------------------------

    const originalName = file.originalname || "";

    const fileExt = originalName
      .split(".")
      .pop()
      .toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
      return res.status(400).json({
        message: "Định dạng file không được hỗ trợ.",
        allowedExtensions: ALLOWED_EXTENSIONS
      });
    }

    // -------------------------------------------------
    // Kiểm tra MIME
    // -------------------------------------------------

    if (
      file.mimetype &&
      !ALLOWED_MIME_TYPES.includes(file.mimetype)
    ) {
      return res.status(400).json({
        message: "Loại file không được hỗ trợ.",
        mimetype: file.mimetype
      });
    }

    // -------------------------------------------------
    // Tạo tên file
    // -------------------------------------------------

    const fileName = `${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 10)}.${fileExt}`;

    // -------------------------------------------------
    // Upload Storage
    // -------------------------------------------------

    const {
      error: storageError
    } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(
        fileName,
        file.buffer,
        {
          contentType: file.mimetype,
          upsert: false
        }
      );

    if (storageError) {
      console.error(
        "Storage upload error:",
        storageError
      );

      return res.status(500).json({
        message:
          "Không thể lưu tệp lên Storage",
        error: storageError.message,
        bucket: BUCKET_NAME
      });
    }

    // -------------------------------------------------
    // Lấy Public URL
    // -------------------------------------------------

    const {
      data: urlData
    } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    const publicUrl =
      urlData?.publicUrl;

    if (!publicUrl) {

      await supabase.storage
        .from(BUCKET_NAME)
        .remove([fileName]);

      return res.status(500).json({
        message:
          "Không thể lấy URL của file."
      });
    }

    // -------------------------------------------------
    // Lưu DB
    // -------------------------------------------------

    const {
      data: newDoc,
      error: dbError
    } = await supabase
      .from("documents")
      .insert({
        uploader_id,

        title:
          String(title).trim(),

        description:
          description
            ? String(description).trim()
            : null,

        category:
          category || "LECTURE_NOTE",

        file_path:
          publicUrl,

        original_author:
          original_author
            ? String(original_author).trim()
            : null,

        source_citation:
          source_citation
            ? String(source_citation).trim()
            : null,

        license_confirmed:
          true,

        status:
          "PENDING"
      })
      .select(
        "*, users:uploader_id (id, username, role)"
      )
      .single();

    // -------------------------------------------------
    // DB lỗi → xóa file Storage
    // -------------------------------------------------

    if (dbError) {

      console.error(
        "DB insert error:",
        dbError
      );

      await supabase.storage
        .from(BUCKET_NAME)
        .remove([fileName]);

      return res.status(500).json({
        message:
          "Không thể lưu tài liệu vào CSDL",
        error:
          dbError.message
      });
    }

    // -------------------------------------------------
    // Thành công
    // -------------------------------------------------

    return res.status(201).json({
      message:
        "Đăng tải tài liệu thành công, đang chờ kiểm duyệt.",

      document:
        newDoc
    });

  } catch (error) {

    console.error(
      "Upload server error:",
      error
    );

    return res.status(500).json({
      message:
        "Server Error",

      error:
        error.message
    });
  }
};


// =====================================================
// 2. LẤY TÀI LIỆU ĐÃ DUYỆT
// =====================================================

const getApprovedDocuments = async (req, res) => {
  try {

    const {
      search,
      category
    } = req.query;

    let query = supabase
      .from("documents")
      .select(
        "*, users:uploader_id (id, username, role)"
      )
      .eq(
        "status",
        "APPROVED"
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );

    // Lọc category
    if (
      category &&
      category !== "ALL"
    ) {
      query =
        query.eq(
          "category",
          category
        );
    }

    // Tìm kiếm
    if (search) {
      query =
        query.ilike(
          "title",
          `%${search.trim()}%`
        );
    }

    const {
      data: docs,
      error
    } = await query;

    if (error) {

      console.error(
        "Get approved documents error:",
        error
      );

      return res.status(500).json({
        message:
          "Lỗi lấy danh sách tài liệu",

        error:
          error.message
      });
    }

    return res.status(200).json({
      total:
        docs?.length || 0,

      documents:
        docs || []
    });

  } catch (error) {

    return res.status(500).json({
      message:
        "Server Error",

      error:
        error.message
    });
  }
};


// =====================================================
// 3. LẤY TÀI LIỆU CHỜ DUYỆT
// =====================================================

const getPendingDocuments = async (req, res) => {
  try {

    const {
      data: docs,
      error
    } = await supabase
      .from("documents")
      .select(
        "*, users:uploader_id (id, username, role)"
      )
      .eq(
        "status",
        "PENDING"
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );

    if (error) {

      console.error(
        "Get pending documents error:",
        error
      );

      return res.status(500).json({
        message:
          "Lỗi lấy danh sách chờ duyệt",

        error:
          error.message
      });
    }

    return res.status(200).json({
      total:
        docs?.length || 0,

      documents:
        docs || []
    });

  } catch (error) {

    return res.status(500).json({
      message:
        "Server Error",

      error:
        error.message
    });
  }
};


// =====================================================
// 4. DUYỆT / TỪ CHỐI TÀI LIỆU
// =====================================================

const updateDocumentStatus = async (req, res) => {
  try {

    const {
      id
    } = req.params;

    const {
      status
    } = req.body;

    // Kiểm tra status
    if (
      !["APPROVED", "REJECTED"]
        .includes(status)
    ) {

      return res.status(400).json({
        message:
          "Trạng thái chỉ nhận giá trị: APPROVED hoặc REJECTED"
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("documents")
      .update({
        status
      })
      .eq(
        "id",
        id
      )
      .select()
      .single();

    if (error) {

      console.error(
        "Update document status error:",
        error
      );

      return res.status(500).json({
        message:
          "Cập nhật trạng thái thất bại",

        error:
          error.message
      });
    }

    return res.status(200).json({
      message:
        `Đã cập nhật trạng thái sang ${status}`,

      document:
        data
    });

  } catch (error) {

    return res.status(500).json({
      message:
        "Server Error",

      error:
        error.message
    });
  }
};


// =====================================================
// EXPORT
// =====================================================

module.exports = {
  uploadDocument,
  getApprovedDocuments,
  getPendingDocuments,
  updateDocumentStatus
};

