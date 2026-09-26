const axios = require("axios");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

// =====================================================
// TẢI FILE TỪ URL
// =====================================================

const getFileBuffer = async (fileUrl) => {
  try {
    const response = await axios.get(
      fileUrl,
      {
        responseType: "arraybuffer",
        timeout: 30000
      }
    );

    return Buffer.from(
      response.data
    );

  } catch (error) {

    console.error(
      "Download document error:",
      error.message
    );

    throw new Error(
      "Không thể tải tài liệu từ Storage."
    );
  }
};


// =====================================================
// LẤY EXTENSION
// =====================================================

const getExtension = (fileUrl) => {

  try {

    const cleanUrl =
      fileUrl.split("?")[0];

    return cleanUrl
      .split(".")
      .pop()
      .toLowerCase();

  } catch (error) {

    return "";
  }
};


// =====================================================
// ĐỌC PDF
// =====================================================

const parsePdf = async (
  buffer
) => {

  try {

    const data =
      await pdfParse(buffer);

    return data.text || "";

  } catch (error) {

    console.error(
      "Parse PDF error:",
      error.message
    );

    throw new Error(
      "Không thể đọc nội dung PDF."
    );
  }
};


// =====================================================
// ĐỌC DOCX
// =====================================================

const parseDocx = async (
  buffer
) => {

  try {

    const result =
      await mammoth.extractRawText({
        buffer
      });

    return result.value || "";

  } catch (error) {

    console.error(
      "Parse DOCX error:",
      error.message
    );

    throw new Error(
      "Không thể đọc nội dung DOCX."
    );
  }
};


// =====================================================
// ĐỌC XLS / XLSX
// =====================================================

const parseExcel = async (
  buffer
) => {

  try {

    const workbook =
      XLSX.read(
        buffer,
        {
          type: "buffer"
        }
      );

    let text = "";

    for (
      const sheetName of
      workbook.SheetNames
    ) {

      const sheet =
        workbook.Sheets[
          sheetName
        ];

      text +=
        `\n\n===== SHEET: ${sheetName} =====\n\n`;

      text +=
        XLSX.utils.sheet_to_txt(
          sheet
        );
    }

    return text;

  } catch (error) {

    console.error(
      "Parse Excel error:",
      error.message
    );

    throw new Error(
      "Không thể đọc nội dung Excel."
    );
  }
};


// =====================================================
// ĐỌC TÀI LIỆU
// =====================================================

const extractDocumentText =
  async (fileUrl) => {

    if (!fileUrl) {

      throw new Error(
        "Không có đường dẫn tài liệu."
      );
    }

    console.log(
      "================================="
    );

    console.log(
      "DOCUMENT PARSER"
    );

    console.log(
      "URL:",
      fileUrl
    );

    const extension =
      getExtension(fileUrl);

    console.log(
      "Extension:",
      extension
    );

    console.log(
      "================================="
    );


    // -------------------------------------------------
    // TẢI FILE
    // -------------------------------------------------

    const buffer =
      await getFileBuffer(
        fileUrl
      );


    // -------------------------------------------------
    // PDF
    // -------------------------------------------------

    if (
      extension === "pdf"
    ) {

      return await parsePdf(
        buffer
      );
    }


    // -------------------------------------------------
    // DOCX
    // -------------------------------------------------

    if (
      extension === "docx"
    ) {

      return await parseDocx(
        buffer
      );
    }


    // -------------------------------------------------
    // XLS / XLSX
    // -------------------------------------------------

    if (
      extension === "xls" ||
      extension === "xlsx"
    ) {

      return await parseExcel(
        buffer
      );
    }


    // -------------------------------------------------
    // CHƯA HỖ TRỢ
    // -------------------------------------------------

    throw new Error(
      `Định dạng .${extension} hiện chưa được hỗ trợ.`
    );
  };


// =====================================================
// EXPORT
// =====================================================

module.exports = {
  extractDocumentText
};