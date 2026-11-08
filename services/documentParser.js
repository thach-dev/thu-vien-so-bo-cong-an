
const axios = require("axios");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

// Giới hạn dung lượng tải xuống: 25 MB
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// =====================================================
// 1. KIỂM TRA VÀ LẤY URL FILE SUPABASE
// =====================================================

const validateFileUrl = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== "string") {
    throw new Error("Không có đường dẫn tài liệu.");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(fileUrl);
  } catch {
    throw new Error("Đường dẫn tài liệu không hợp lệ.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("Chỉ chấp nhận đường dẫn HTTPS.");
  }

  const supabaseUrl = process.env.SUPABASE_URL;

  if (!supabaseUrl) {
    throw new Error("Chưa cấu hình SUPABASE_URL.");
  }

  const projectHost = new URL(supabaseUrl).hostname;

  if (parsedUrl.hostname !== projectHost) {
    throw new Error("URL tài liệu không thuộc Supabase Storage của dự án.");
  }

  if (!parsedUrl.pathname.startsWith("/storage/v1/object/public/documents/")) {
    throw new Error("Đường dẫn không thuộc bucket documents public.");
  }

  return parsedUrl;
};

// =====================================================
// 2. XÁC ĐỊNH ĐỊNH DẠNG FILE
// =====================================================

const getExtension = (fileUrl) => {
  try {
    const parsedUrl = new URL(fileUrl);
    const pathname = decodeURIComponent(parsedUrl.pathname);
    const filename = pathname.split("/").pop();

    const extension = filename.includes(".")
      ? filename.split(".").pop().toLowerCase()
      : "";

    return extension;
  } catch {
    return "";
  }
};

// =====================================================
// 3. TẢI FILE TỪ SUPABASE STORAGE
// =====================================================

const getFileBuffer = async (fileUrl) => {
  try {
    validateFileUrl(fileUrl);

    const response = await axios.get(fileUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: MAX_FILE_SIZE,
      maxBodyLength: MAX_FILE_SIZE,
      maxRedirects: 0,
      validateStatus: (status) => status === 200,
    });

    const buffer = Buffer.from(response.data);

    if (!buffer.length) {
      throw new Error("File tài liệu đang trống.");
    }

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error("Tài liệu vượt quá giới hạn 25 MB.");
    }

    return buffer;
  } catch (error) {
    console.error("DOWNLOAD DOCUMENT ERROR:", error.message);

    if (error.message.includes("URL") ||
        error.message.includes("bucket") ||
        error.message.includes("25 MB") ||
        error.message.includes("trống")) {
      throw error;
    }

    throw new Error(
      "Không thể tải tài liệu từ Supabase Storage."
    );
  }
};

// =====================================================
// 4. ĐỌC PDF THEO TỪNG TRANG
// =====================================================

const parsePdfWithPages = async (buffer) => {
  try {
    const pages = [];

    const data = await pdfParse(buffer, {
      pagerender: async (pageData) => {
        const textContent = await pageData.getTextContent();

        const pageText = textContent.items
          .map((item) => item.str || "")
          .join(" ");

        const pageNumber = pages.length + 1;

        pages.push({
          page_number: pageNumber,
          content: pageText.trim(),
        });

        return pageText;
      },
    });

    // Trả về danh sách trang có nội dung.
    return pages.filter((page) => page.content);
  } catch (error) {
    console.error("PARSE PDF ERROR:", error.message);
    throw new Error("Không thể đọc nội dung PDF.");
  }
};

// =====================================================
// 5. ĐỌC DOCX
// =====================================================

const parseDocx = async (buffer) => {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch (error) {
    console.error("PARSE DOCX ERROR:", error.message);
    throw new Error("Không thể đọc nội dung DOCX.");
  }
};

// =====================================================
// 6. ĐỌC EXCEL
// =====================================================

const parseExcel = async (buffer) => {
  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
    });

    let text = "";

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];

      text += `\n\n===== SHEET: ${sheetName} =====\n\n`;

      text += XLSX.utils.sheet_to_txt(sheet);
    }

    return text;
  } catch (error) {
    console.error("PARSE EXCEL ERROR:", error.message);
    throw new Error("Không thể đọc nội dung Excel.");
  }
};

// =====================================================
// 7. ĐỌC TÀI LIỆU - TƯƠNG THÍCH CODE CŨ
// =====================================================

const extractDocumentText = async (fileUrl) => {
  const extension = getExtension(fileUrl);

  const supportedExtensions = [
    "pdf",
    "docx",
    "xls",
    "xlsx",
  ];

  if (!supportedExtensions.includes(extension)) {
    throw new Error(
      `Định dạng .${extension || "không xác định"} hiện chưa được hỗ trợ.`
    );
  }

  const buffer = await getFileBuffer(fileUrl);

  if (extension === "pdf") {
    const pages = await parsePdfWithPages(buffer);
    return pages.map((page) => page.content).join("\n\n");
  }

  if (extension === "docx") {
    return await parseDocx(buffer);
  }

  if (extension === "xls" || extension === "xlsx") {
    return await parseExcel(buffer);
  }

  throw new Error("Không hỗ trợ định dạng tài liệu này.");
};

// =====================================================
// 8. HÀM ĐỌC PDF CÓ SỐ TRANG
// =====================================================

const extractDocumentPages = async (fileUrl) => {
  const extension = getExtension(fileUrl);

  if (extension !== "pdf") {
    throw new Error("Hàm này hiện chỉ hỗ trợ PDF.");
  }

  const buffer = await getFileBuffer(fileUrl);

  return await parsePdfWithPages(buffer);
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  extractDocumentText,
  extractDocumentPages,
  getFileBuffer,
  getExtension,
};
