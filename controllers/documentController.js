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
    // KIỂM TRA DỮ LIỆU
    // -------------------------------------------------

    if (!uploader_id || !title || !file) {
      return res.status(400).json({
        message:
          "Thiếu dữ liệu bắt buộc: uploader_id, title hoặc file."
      });
    }

    // -------------------------------------------------
    // KIỂM TRA BẢN QUYỀN
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
    // LẤY PHẦN MỞ RỘNG
    // -------------------------------------------------

    const originalName =
      file.originalname || "";

    const fileExt =
      originalName
        .split(".")
        .pop()
        .toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
      return res.status(400).json({
        message:
          "Định dạng file không được hỗ trợ.",

        allowedExtensions:
          ALLOWED_EXTENSIONS
      });
    }

    // -------------------------------------------------
    // KIỂM TRA MIME
    // -------------------------------------------------

    if (
      file.mimetype &&
      !ALLOWED_MIME_TYPES.includes(file.mimetype)
    ) {
      return res.status(400).json({
        message:
          "Loại file không được hỗ trợ.",

        mimetype:
          file.mimetype
      });
    }

    // -------------------------------------------------
    // TẠO TÊN FILE
    // -------------------------------------------------

    const fileName =
      `${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 10)}.${fileExt}`;

    // -------------------------------------------------
    // UPLOAD STORAGE
    // -------------------------------------------------

    const {
      error: storageError
    } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(
        fileName,
        file.buffer,
        {
          contentType:
            file.mimetype,

          upsert:
            false
        }
      );

    if (storageError) {
      console.error(
        "Storage upload error:",
        storageError
      );

      return res.status(500).json({
        message:
          "Không thể lưu tệp lên Storage.",

        error:
          storageError.message,

        bucket:
          BUCKET_NAME
      });
    }

    // -------------------------------------------------
    // LẤY PUBLIC URL
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
        .remove([
          fileName
        ]);

      return res.status(500).json({
        message:
          "Không thể lấy URL của file."
      });
    }

    // -------------------------------------------------
    // LƯU DATABASE
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
    // DATABASE LỖI → XÓA FILE
    // -------------------------------------------------

    if (dbError) {

      console.error(
        "DB insert error:",
        dbError
      );

      await supabase.storage
        .from(BUCKET_NAME)
        .remove([
          fileName
        ]);

      return res.status(500).json({
        message:
          "Không thể lưu tài liệu vào CSDL.",

        error:
          dbError.message
      });
    }

    // -------------------------------------------------
    // THÀNH CÔNG
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
      data: docs,
      error
    } = await supabase
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

    console.error(
      "Get approved server error:",
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
// 3. TÌM KIẾM TÀI LIỆU
// =====================================================

const searchDocuments = async (req, res) => {
  try {

    const {
      q,
      category,
      page = 1,
      limit = 20
    } = req.query;

    // =================================================
    // CHUẨN HÓA TỪ KHÓA
    // =================================================

    const keyword =
      q
        ? String(q).trim()
        : "";

    // =================================================
    // CHUẨN HÓA PAGE
    // =================================================

    const pageNumber =
      Math.max(
        parseInt(page, 10) || 1,
        1
      );

    // =================================================
    // CHUẨN HÓA LIMIT
    // TỐI ĐA 100 KẾT QUẢ / REQUEST
    // =================================================

    const limitNumber =
      Math.min(
        Math.max(
          parseInt(limit, 10) || 20,
          1
        ),
        100
      );

    // =================================================
    // TÍNH RANGE
    // =================================================

    const from =
      (pageNumber - 1) *
      limitNumber;

    const to =
      from +
      limitNumber -
      1;

    console.log("=================================");
    console.log("SEARCH DOCUMENTS");
    console.log("Keyword:", keyword);
    console.log("Category:", category);
    console.log("Page:", pageNumber);
    console.log("Limit:", limitNumber);
    console.log("Range:", from, "-", to);
    console.log("=================================");

    // =================================================
    // QUERY DATABASE
    // =================================================

    let query =
      supabase
        .from("documents")
        .select(
          "*, users:uploader_id (id, username, role)",
          {
            count: "exact"
          }
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
        )
        .range(
          from,
          to
        );

    // =================================================
    // TÌM KIẾM
    // =================================================
    // Tìm trong:
    // - title
    // - description
    // - original_author
    // - source_citation

    if (keyword) {

      query =
        query.or(
          [
            `title.ilike.%${keyword}%`,
            `description.ilike.%${keyword}%`,
            `original_author.ilike.%${keyword}%`,
            `source_citation.ilike.%${keyword}%`
          ].join(",")
        );

    }

    // =================================================
    // LỌC CATEGORY
    // =================================================

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

    // =================================================
    // THỰC THI QUERY
    // =================================================

    const {
      data: docs,
      error,
      count
    } = await query;

    // =================================================
    // DATABASE ERROR
    // =================================================

    if (error) {

      console.error(
        "Search documents error:",
        error
      );

      return res.status(500).json({
        message:
          "Lỗi tìm kiếm tài liệu",

        error:
          error.message
      });
    }

    // =================================================
    // TÍNH TOTAL
    // =================================================

    const total =
      count || 0;

    const totalPages =
      Math.ceil(
        total /
        limitNumber
      );

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({

      total,

      page:
        pageNumber,

      limit:
        limitNumber,

      totalPages,

      documents:
        docs || []

    });

  } catch (error) {

    console.error(
      "Search server error:",
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
// 4. LẤY TÀI LIỆU CHỜ DUYỆT
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

    console.error(
      "Get pending server error:",
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
// 5. DUYỆT / TỪ CHỐI TÀI LIỆU
// =====================================================

const updateDocumentStatus = async (req, res) => {
  try {

    const {
      id
    } = req.params;

    const {
      status
    } = req.body;

    // =================================================
    // KIỂM TRA STATUS
    // =================================================

    if (
      ![
        "APPROVED",
        "REJECTED"
      ].includes(status)
    ) {

      return res.status(400).json({
        message:
          "Trạng thái chỉ nhận giá trị: APPROVED hoặc REJECTED"
      });
    }

    // =================================================
    // UPDATE
    // =================================================

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

    // =================================================
    // ERROR
    // =================================================

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

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(200).json({
      message:
        `Đã cập nhật trạng thái sang ${status}`,

      document:
        data
    });

  } catch (error) {

    console.error(
      "Update status server error:",
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
// ==============================
// LẤY DANH SÁCH LOẠI TÀI LIỆU
// ==============================
const getDocumentCategories = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("documents")
      .select("category")
      .eq("status", "APPROVED")
      .not("category", "is", null);

    if (error) {
      console.error(
        "Get document categories error:",
        error
      );

      return res.status(500).json({
        message: "Lỗi lấy danh sách loại tài liệu",
        error: error.message
      });
    }

    // Loại bỏ trùng
    const categories = [
      ...new Set(
        (data || [])
          .map((item) => item.category)
          .filter(Boolean)
      )
    ];

    return res.status(200).json({
      categories
    });
  } catch (error) {
    console.error(
      "Get categories server error:",
      error
    );

    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  uploadDocument,
  getApprovedDocuments,
  searchDocuments,
  getDocumentCategories,
  getPendingDocuments,
  updateDocumentStatus
};