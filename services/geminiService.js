const {
  GoogleGenerativeAI
} = require("@google/generative-ai");


// =====================================================
// GEMINI
// =====================================================

const genAI =
  new GoogleGenerativeAI(
    process.env.GEMINI_API_KEY
  );


// =====================================================
// MODEL
// =====================================================

const model =
  genAI.getGenerativeModel({
    model: "gemini-2.5-flash"
  });


// =====================================================
// HỎI AI
// =====================================================

const askGemini = async (
  question,
  documentText,
  documentTitle
) => {

  if (!question) {

    throw new Error(
      "Câu hỏi không được để trống."
    );
  }

  if (!documentText) {

    throw new Error(
      "Tài liệu không có nội dung."
    );
  }


  const prompt = `
Bạn là trợ lý AI của một thư viện tài liệu.

Bạn đang hỗ trợ người dùng tìm hiểu nội dung của tài liệu.

==================================================
THÔNG TIN TÀI LIỆU
==================================================

Tên tài liệu:
${documentTitle || "Không xác định"}

==================================================
NỘI DUNG TÀI LIỆU
==================================================

${documentText}

==================================================
CÂU HỎI NGƯỜI DÙNG
==================================================

${question}

==================================================
QUY TẮC TRẢ LỜI
==================================================

1. Chỉ sử dụng thông tin có trong tài liệu.

2. Không được tự bịa thông tin.

3. Nếu tài liệu không chứa thông tin cần thiết,
hãy nói:

"Tôi không tìm thấy thông tin này trong tài liệu."

4. Trả lời bằng tiếng Việt.

5. Trả lời rõ ràng, dễ hiểu.

6. Nếu câu hỏi yêu cầu giải thích,
hãy giải thích dựa trên nội dung tài liệu.

7. Nếu có thể xác định được phần, chương hoặc
nội dung liên quan thì hãy đề cập.

8. Không nói rằng bạn đã đọc tài liệu nếu chưa
có thông tin tương ứng trong nội dung được cung cấp.

==================================================
TRẢ LỜI
==================================================
`;


  try {

    const result =
      await model.generateContent(
        prompt
      );

    const response =
      result.response;

    return response.text();

  } catch (error) {

    console.error(
      "Gemini error:",
      error
    );

    throw new Error(
      "Không thể nhận phản hồi từ AI."
    );
  }
};


// =====================================================
// EXPORT
// =====================================================

module.exports = {
  askGemini
};