const supabase = require("../supabase");

// 1. Tải lên tài liệu mới (Học viên) -> trạng thái PENDING
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

    // Kiểm tra dữ liệu bắt buộc
    if (!uploader_id || !title || !file) {
      return res.status(400).json({
        message: "Thiếu dữ liệu bắt buộc: uploader_id, title hoặc tệp PDF."
      });
    }

    // Cam kết bản quyền bắt buộc theo đề tài NCKH
    const isLicenseConfirmed = license_confirmed === true || license_confirmed === "true";
    if (!isLicenseConfirmed) {
      return res.status(400).json({
        message: "Bạn phải đồng ý cam kết tuân thủ quyền sở hữu trí tuệ."
      });
    }

    // Tải file lên Supabase Storage bucket 'documents'
    const fileExt = file.originalname.split(".").pop();
    const fileName = `\({Date.now()}_\){Math.random().toString(36).substring(7)}.${fileExt}`;

    const { error: storageError } = await supabase.storage
      .from("documents")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (storageError) {
      console.error("Storage upload error:", storageError);
      return res.status(500).json({
        message: "Không thể lưu tệp lên Storage",
        error: storageError.message
      });
    }

    // Lấy link công khai của file vừa tải lên
    const { data: urlData } = supabase.storage
      .from("documents")
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // Lưu thông tin vào bảng 'documents'
    const { data: newDoc, error: dbError } = await supabase
      .from("documents")
      .insert({
        uploader_id,
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        category: category || "LECTURE_NOTE",
        file_path: publicUrl,
        original_author: originalAuthor ? String(originalAuthor).trim() : null,
        source_citation: sourceCitation ? String(sourceCitation).trim() : null,
        license_confirmed: true,
        status: "PENDING"
      })
      .select("*, users:uploader_id (id, username, role)")
      .single();

    if (dbError) {
      console.error("DB insert error:", dbError);
      // Xóa file trên bucket nếu insert DB thất bại để tránh rác dung lượng
      await supabase.storage.from("documents").remove([fileName]);
      return res.status(500).json({
        message: "Không thể lưu tài liệu vào CSDL",
        error: dbError.message
      });
    }

    return res.status(201).json({
      message: "Đăng tải tài liệu thành công, đang chờ kiểm duyệt.",
      document: newDoc
    });

  } catch (error) {
    console.error("Upload server error:", error);
    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};

// 2. Lấy danh sách tài liệu đã duyệt (Kho tài nguyên chung)
const getApprovedDocuments = async (req, res) => {
  try {
    const { search, category } = req.query;

    let query = supabase
      .from("documents")
      .select("*, users:uploader_id (id, username, role)")
      .eq("status", "APPROVED")
      .order("created_at", { ascending: false });

    if (category && category !== "ALL") {
      query = query.eq("category", category);
    }

    if (search) {
      query = query.ilike("title", `%${search.trim()}%`);
    }

    const { data: docs, error } = await query;

    if (error) {
      return res.status(500).json({
        message: "Lỗi lấy danh sách tài liệu",
        error: error.message
      });
    }

    return res.status(200).json({
      total: docs.length,
      documents: docs
    });

  } catch (error) {
    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};

// 3. Lấy danh sách tài liệu chờ duyệt (Dành cho Admin)
const getPendingDocuments = async (req, res) => {
  try {
    const { data: docs, error } = await supabase
      .from("documents")
      .select("*, users:uploader_id (id, username, role)")
      .eq("status", "PENDING")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        message: "Lỗi lấy danh sách chờ duyệt",
        error: error.message
      });
    }

    return res.status(200).json({
      total: docs.length,
      documents: docs
    });

  } catch (error) {
    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};

// 4. Cập nhật trạng thái duyệt: APPROVED hoặc REJECTED
const updateDocumentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({
        message: "Trạng thái chỉ nhận giá trị: APPROVED hoặc REJECTED"
      });
    }

    const { data, error } = await supabase
      .from("documents")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        message: "Cập nhật trạng thái thất bại",
        error: error.message
      });
    }

    return res.status(200).json({
      message: `Đã cập nhật trạng thái sang ${status}`,
      document: data
    });

  } catch (error) {
    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};

module.exports = {
  uploadDocument,
  getApprovedDocuments,
  getPendingDocuments,
  updateDocumentStatus
};  