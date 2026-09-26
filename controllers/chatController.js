const {
  extractDocumentText
} = require("../services/documentParser");

const {
  askGemini
} = require("../services/geminiService");


// =====================================================
// CHAT VỚI TÀI LIỆU
// =====================================================

const chatWithDocument =
  async (req, res) => {

    try {

      const {
        question,
        documentId,
        documentTitle,
        filePath
      } = req.body;


      // =============================================
      // KIỂM TRA QUESTION
      // =============================================

      if (
        !question ||
        !String(question).trim()
      ) {

        return res.status(400).json({

          message:
            "Vui lòng nhập câu hỏi."

        });
      }


      // =============================================
      // KIỂM TRA FILE
      // =============================================

      if (!filePath) {

        return res.status(400).json({

          message:
            "Không tìm thấy tài liệu."

        });
      }


      console.log(
        "================================="
      );

      console.log(
        "AI CHAT"
      );

      console.log(
        "Document ID:",
        documentId
      );

      console.log(
        "Document title:",
        documentTitle
      );

      console.log(
        "Question:",
        question
      );

      console.log(
        "================================="
      );


      // =============================================
      // ĐỌC TÀI LIỆU
      // =============================================

      const documentText =
        await extractDocumentText(
          filePath
        );


      if (
        !documentText ||
        !documentText.trim()
      ) {

        return res.status(400).json({

          message:
            "Không thể lấy nội dung từ tài liệu."

        });
      }


      console.log(
        "Document text length:",
        documentText.length
      );


      // =============================================
      // GỬI GEMINI
      // =============================================

      const answer =
        await askGemini(
          String(question).trim(),
          documentText,
          documentTitle
        );


      // =============================================
      // RESPONSE
      // =============================================

      return res.status(200).json({

        message:
          "AI trả lời thành công.",

        answer

      });


    } catch (error) {

      console.error(
        "Chat controller error:",
        error
      );


      return res.status(500).json({

        message:
          error.message ||
          "Không thể xử lý câu hỏi."

      });

    }
  };


// =====================================================
// EXPORT
// =====================================================

module.exports = {
  chatWithDocument
};