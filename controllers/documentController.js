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
    // DEBUG
    // =================================================

    console.log("=================================");
    console.log("UPLOAD DOCUMENT");
    console.log("Uploader ID:", id);
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
        message: "Thiếu dữ liệu bắt buộc: id, title hoặc file.",
      });
    }

    // =================================================
    // KIỂM TRA BUFFER
    // =================================================

    if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
      console.error("FILE BUFFER ERROR");

      return res.status(400).json({
        message: "Không đọc được nội dung file.",
      });
    }

    // =================================================
    // KIỂM TRA LICENSE
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
    // KIỂM TRA USER
    // =================================================
    // id từ Frontend được dùng làm uploader_id
    // KHÔNG dùng id này làm documents.id
    // =================================================

    console.log("Checking uploader:", id);

    const {
      data: uploader,
      error: uploaderError,
    } = await supabase
      .from("users")
      .select("id, username, role")
      .eq("id", id)
      .maybeSingle();

    if (uploaderError) {
      console.error("Check uploader error:", uploaderError);

      return res.status(500).json({
        message: "Không thể kiểm tra người đăng tài liệu.",
        error: uploaderError.message,
      });
    }

    if (!uploader) {
      console.error("Uploader not found:", id);

      return res.status(400).json({
        message: "Tài khoản đăng tài liệu không tồn tại.",
        uploader_id: id,
      });
    }

    console.log("Uploader found:", uploader);

    // =================================================
    // TÊN FILE GỐC
    // =================================================

    const originalName = decodeFileName(
      file.originalname || ""
    );

    console.log("Decoded original filename:", originalName);

    // =================================================
    // EXTENSION
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
            file.mimetype ||
            "application/octet-stream",

          upsert: false,
        }
      );

    // =================================================
    // STORAGE ERROR
    // =================================================

    if (storageError) {
      console.error("=================================");
      console.error("STORAGE UPLOAD ERROR");
      console.error("Message:", storageError.message);
      console.error("Details:", storageError);
      console.error("=================================");

      return res.status(500).json({
        message: "Không thể lưu tệp lên Storage.",
        error: storageError.message,
        bucket: BUCKET_NAME,
      });
    }

    console.log(
      "Storage upload success:",
      storageData
    );

    // =================================================
    // PUBLIC URL
    // =================================================

    console.log("Generating public URL...");

    const {
      data: urlData,
    } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    const publicUrl =
      urlData?.publicUrl;

    console.log("Public URL:", publicUrl);

    // =================================================
    // KIỂM TRA PUBLIC URL
    // =================================================

    if (!publicUrl) {
      console.error("PUBLIC URL ERROR");

      await supabase.storage
        .from(BUCKET_NAME)
        .remove([fileName]);

      return res.status(500).json({
        message: "Không thể lấy URL của file.",
      });
    }

    // =================================================
    // INSERT DATABASE
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
        // KHÔNG truyền id document
        // Database tự tạo UUID

        uploader_id: uploader.id,

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
      console.error("=================================");
      console.error("DATABASE INSERT ERROR");
      console.error("Message:", dbError.message);
      console.error("Code:", dbError.code);
      console.error("Details:", dbError.details);
      console.error("Hint:", dbError.hint);
      console.error("Full error:", dbError);
      console.error("=================================");

      // -----------------------------------------------
      // XÓA FILE STORAGE
      // -----------------------------------------------

      console.log(
        "Removing uploaded file..."
      );

      const {
        data: removeData,
        error: removeError,
      } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([fileName]);

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
    // SUCCESS
    // =================================================

    console.log("=================================");
    console.log("UPLOAD DOCUMENT SUCCESS");
    console.log("Document ID:", newDoc?.id);
    console.log("Uploader ID:", newDoc?.uploader_id);
    console.log("File:", fileName);
    console.log("=================================");

    return res.status(201).json({
      message:
        "Đăng tải tài liệu thành công, đang chờ kiểm duyệt.",

      document:
        newDoc,
    });

  } catch (error) {

    console.error("=================================");
    console.error("UPLOAD SERVER ERROR");
    console.error("Message:", error.message);
    console.error("Name:", error.name);
    console.error("Stack:", error.stack);
    console.error("Full error:", error);
    console.error("=================================");

    // =================================================
    // ROLLBACK STORAGE
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
      message: "Server Error",
      error: error.message,
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

    const keyword =
      q
        ? String(q).trim()
        : "";

    const pageNumber =
      Math.max(
        parseInt(page, 10) || 1,
        1
      );

    const limitNumber =
      Math.min(
        Math.max(
          parseInt(limit, 10) || 20,
          1
        ),
        100
      );

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

    const {
      data: docs,
      error,
      count,
    } = await query;

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

    const total =
      count || 0;

    const totalPages =
      Math.ceil(
        total /
        limitNumber
      );

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
// 5. DUYỆT / TỪ CHỐI
// =====================================================

const updateDocumentStatus = async (req, res) => {
  try {

    const {
      id,
    } = req.params;

    const {
      status,
    } = req.body;

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
// 6. LẤY DANH SÁCH CATEGORY
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

