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
  "xlsx",
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
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

// =====================================================
// HÀM GIẢI MÃ TÊN FILE TIẾNG VIỆT
// =====================================================

const decodeFileName = (fileName) => {
  if (!fileName) return "";

  try {
    // Multer đôi khi trả filename UTF-8 dưới dạng latin1
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
      id,
      title,
      description,
      category,
      original_author,
      source_citation,
      license_confirmed,
    } = req.body;

    const file = req.file;

    // =================================================
    // LOG REQUEST
    // =================================================

    console.log("=================================");
    console.log("UPLOAD DOCUMENT");
    console.log("Uploader:", id);
    console.log("Title:", title);
    console.log("Original File:", file?.originalname);
    console.log("Decoded File:", decodeFileName(file?.originalname));
    console.log("Mimetype:", file?.mimetype);
    console.log("Size:", file?.size);
    console.log("Buffer:", !!file?.buffer);
    console.log("Bucket:", BUCKET_NAME);
    console.log("=================================");

    // =================================================
    // KIỂM TRA DỮ LIỆU
    // =================================================

    if (!id || !title || !file) {
      return res.status(400).json({
        message:
          "Thiếu dữ liệu bắt buộc: id, title hoặc file.",
      });
    }

    // =================================================
    // KIỂM TRA FILE BUFFER
    // =================================================

    if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
      console.error("FILE BUFFER ERROR");

      return res.status(400).json({
        message: "Không đọc được nội dung file.",
      });
    }

    // =================================================
    // KIỂM TRA BẢN QUYỀN
    // =================================================

    const isLicenseConfirmed =
      license_confirmed === true ||
      license_confirmed === "true";

    if (!isLicenseConfirmed) {
      return res.status(400).json({
        message:
          "Bạn phải đồng ý cam kết tuân thủ quyền sở hữu trí tuệ.",
      });
    }

    // =================================================
    // LẤY TÊN FILE GỐC
    // =================================================

    const originalName = decodeFileName(
      file.originalname || ""
    );

    console.log("Decoded original filename:", originalName);

    // =================================================
    // LẤY PHẦN MỞ RỘNG
    // =================================================

    const fileExt = originalName
      .split(".")
      .pop()
      .toLowerCase();

    console.log("File extension:", fileExt);

    // =================================================
    // KIỂM TRA EXTENSION
    // =================================================

    if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
      return res.status(400).json({
        message: "Định dạng file không được hỗ trợ.",
        allowedExtensions: ALLOWED_EXTENSIONS,
      });
    }

    // =================================================
    // KIỂM TRA MIME
    // =================================================

    if (
      file.mimetype &&
      !ALLOWED_MIME_TYPES.includes(file.mimetype)
    ) {
      return res.status(400).json({
        message: "Loại file không được hỗ trợ.",
        mimetype: file.mimetype,
      });
    }

    // =================================================
    // TẠO TÊN FILE STORAGE
    // =================================================

    const fileName =
      `${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 10)}.${fileExt}`;

    uploadedFileName = fileName;

    console.log("Storage filename:", fileName);

    // =================================================
    // UPLOAD STORAGE
    // =================================================

    console.log("Uploading to Supabase Storage...");

    const {
      data: storageData,
      error: storageError,
    } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(
        fileName,
        file.buffer,
        {
          contentType:
            file.mimetype || "application/octet-stream",

          upsert: false,
        }
      );

    // =================================================
    // STORAGE ERROR
    // =================================================

    if (storageError) {
      console.error(
        "================================="
      );

      console.error(
        "STORAGE UPLOAD ERROR"
      );

      console.error(
        "Message:",
        storageError.message
      );

      console.error(
        "Details:",
        storageError
      );

      console.error(
        "================================="
      );

      return res.status(500).json({
        message:
          "Không thể lưu tệp lên Storage.",

        error:
          storageError.message,

        bucket:
          BUCKET_NAME,
      });
    }

    console.log(
      "Storage upload success:",
      storageData
    );

    // =================================================
    // LẤY PUBLIC URL
    // =================================================

    console.log(
      "Generating public URL..."
    );

    const {
      data: urlData,
    } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    const publicUrl =
      urlData?.publicUrl;

    console.log(
      "Public URL:",
      publicUrl
    );

    // =================================================
    // KIỂM TRA PUBLIC URL
    // =================================================

    if (!publicUrl) {
      console.error(
        "PUBLIC URL ERROR"
      );

      await supabase.storage
        .from(BUCKET_NAME)
        .remove([
          fileName,
        ]);

      return res.status(500).json({
        message:
          "Không thể lấy URL của file.",
      });
    }

    // =================================================
    // LƯU DATABASE
    // =================================================

    console.log(
      "Inserting document into database..."
    );

    const {
      data: newDoc,
      error: dbError,
    } = await supabase
      .from("documents")
      .insert({
        id: id,

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
          "PENDING",
      })
      .select("*")
      .single();

    // =================================================
    // DATABASE ERROR
    // =================================================

    if (dbError) {
      console.error(
        "================================="
      );

      console.error(
        "DATABASE INSERT ERROR"
      );

      console.error(
        "Message:",
        dbError.message
      );

      console.error(
        "Code:",
        dbError.code
      );

      console.error(
        "Details:",
        dbError.details
      );

      console.error(
        "Hint:",
        dbError.hint
      );

      console.error(
        "Full error:",
        dbError
      );

      console.error(
        "================================="
      );

      // XÓA FILE ĐÃ UPLOAD
      console.log(
        "Removing uploaded file..."
      );

      const {
        data: removeData,
        error: removeError,
      } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([
          fileName,
        ]);

      if (removeError) {
        console.error(
          "Remove storage file error:",
          removeError
        );
      } else {
        console.log(
          "Storage file removed:",
          removeData
        );
      }

      return res.status(500).json({
        message:
          "Không thể lưu tài liệu vào CSDL.",

        error:
          dbError.message,

        code:
          dbError.code,

        details:
          dbError.details,

        hint:
          dbError.hint,
      });
    }

    // =================================================
    // THÀNH CÔNG
    // =================================================

    console.log(
      "================================="
    );

    console.log(
      "UPLOAD DOCUMENT SUCCESS"
    );

    console.log(
      "Document ID:",
      newDoc?.id
    );

    console.log(
      "File:",
      fileName
    );

    console.log(
      "================================="
    );

    return res.status(201).json({
      message:
        "Đăng tải tài liệu thành công, đang chờ kiểm duyệt.",

      document:
        newDoc,
    });

  } catch (error) {

    console.error(
      "================================="
    );

    console.error(
      "UPLOAD SERVER ERROR"
    );

    console.error(
      "Message:",
      error.message
    );

    console.error(
      "Name:",
      error.name
    );

    console.error(
      "Stack:",
      error.stack
    );

    console.error(
      "Full error:",
      error
    );

    console.error(
      "================================="
    );

    // =================================================
    // ROLLBACK STORAGE NẾU ĐÃ UPLOAD
    // =================================================

    if (uploadedFileName) {

      console.log(
        "Attempting storage rollback:",
        uploadedFileName
      );

      try {

        const {
          error: rollbackError,
        } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([
            uploadedFileName,
          ]);

        if (rollbackError) {

          console.error(
            "Rollback storage error:",
            rollbackError
          );

        } else {

          console.log(
            "Rollback storage success"
          );

        }

      } catch (rollbackException) {

        console.error(
          "Rollback exception:",
          rollbackException
        );
      }
    }

    return res.status(500).json({
      message:
        "Server Error",

      error:
        error.message,
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
      error,
    } = await supabase
      .from("documents")
      .select(
        "*, users:id (id, username, role)"
      )
      .eq(
        "status",
        "APPROVED"
      )
      .order(
        "created_at",
        {
          ascending: false,
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
          error.message,
      });
    }

    return res.status(200).json({
      total:
        docs?.length || 0,

      documents:
        docs || [],
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
        error.message,
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
      limit = 20,
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

    console.log(
      "================================="
    );

    console.log(
      "SEARCH DOCUMENTS"
    );

    console.log(
      "Keyword:",
      keyword
    );

    console.log(
      "Category:",
      category
    );

    console.log(
      "Page:",
      pageNumber
    );

    console.log(
      "Limit:",
      limitNumber
    );

    console.log(
      "Range:",
      from,
      "-",
      to
    );

    console.log(
      "================================="
    );

    // =================================================
    // QUERY DATABASE
    // =================================================

    let query =
      supabase
        .from("documents")
        .select(
          "*, users:id (id, username, role)",
          {
            count: "exact",
          }
        )
        .eq(
          "status",
          "APPROVED"
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        )
        .range(
          from,
          to
        );

    // =================================================
    // TÌM KIẾM
    // =================================================

    if (keyword) {

      query =
        query.or(
          [
            `title.ilike.%${keyword}%`,
            `description.ilike.%${keyword}%`,
            `original_author.ilike.%${keyword}%`,
            `source_citation.ilike.%${keyword}%`,
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
      count,
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
          error.message,
      });
    }

    // =================================================
    // TOTAL
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
        docs || [],
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
        error.message,
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
      error,
    } = await supabase
      .from("documents")
      .select(
        "*, users:id (id, username, role)"
      )
      .eq(
        "status",
        "PENDING"
      )
      .order(
        "created_at",
        {
          ascending: false,
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
          error.message,
      });
    }

    return res.status(200).json({
      total:
        docs?.length || 0,

      documents:
        docs || [],
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
        error.message,
    });
  }
};

// =====================================================
// 5. DUYỆT / TỪ CHỐI TÀI LIỆU
// =====================================================

const updateDocumentStatus = async (req, res) => {
  try {

    const {
      id,
    } = req.params;

    const {
      status,
    } = req.body;

    // =================================================
    // KIỂM TRA STATUS
    // =================================================

    if (
      ![
        "APPROVED",
        "REJECTED",
      ].includes(status)
    ) {

      return res.status(400).json({
        message:
          "Trạng thái chỉ nhận giá trị: APPROVED hoặc REJECTED",
      });
    }

    // =================================================
    // UPDATE
    // =================================================

    const {
      data,
      error,
    } = await supabase
      .from("documents")
      .update({
        status,
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
          error.message,
      });
    }

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(200).json({
      message:
        `Đã cập nhật trạng thái sang ${status}`,

      document:
        data,
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
        error.message,
    });
  }
};

// =====================================================
// 6. LẤY DANH SÁCH LOẠI TÀI LIỆU
// =====================================================

const getDocumentCategories = async (req, res) => {
  try {

    const {
      data,
      error,
    } = await supabase
      .from("documents")
      .select("category")
      .eq(
        "status",
        "APPROVED"
      )
      .not(
        "category",
        "is",
        null
      );

    if (error) {

      console.error(
        "Get document categories error:",
        error
      );

      return res.status(500).json({
        message:
          "Lỗi lấy danh sách loại tài liệu",

        error:
          error.message,
      });
    }

    // =================================================
    // LOẠI BỎ TRÙNG
    // =================================================

    const categories = [
      ...new Set(
        (data || [])
          .map(
            (item) =>
              item.category
          )
          .filter(Boolean)
      ),
    ];

    return res.status(200).json({
      categories,
    });

  } catch (error) {

    console.error(
      "Get categories server error:",
      error
    );

    return res.status(500).json({
      message:
        "Server Error",

      error:
        error.message,
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
  updateDocumentStatus,
};
