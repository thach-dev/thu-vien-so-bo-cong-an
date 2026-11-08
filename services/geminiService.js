
const { GoogleGenerativeAI } = require("@google/generative-ai");

// =====================================================
// 1. CẤU HÌNH GEMINI
// =====================================================

const MODEL_NAME = "gemini-3.8-flash";

let genAI = null;

const getAI = () => {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("Chưa cấu hình GEMINI_API_KEY trong biến môi trường.");
    }

    if (!genAI) {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }

    return genAI.getGenerativeModel({
        model: MODEL_NAME,
    });
};

// =====================================================
// 2. HÀM NHẬN DIỆN LỖI
// =====================================================

const getGeminiErrorMessage = (error) => {
    const status = error?.status || error?.statusCode;
    const message = error?.message || "";

    if (status === 400) {
        return "Yêu cầu không hợp lệ. Vui lòng kiểm tra nội dung gửi lên AI.";
    }

    if (status === 401 || status === 403) {
        return "API Key Gemini không hợp lệ hoặc không có quyền truy cập.";
    }

    if (status === 404) {
        return `Không tìm thấy model Gemini: ${MODEL_NAME}.`;
    }

    if (status === 429) {
        return "Gemini đang vượt giới hạn sử dụng. Vui lòng thử lại sau.";
    }

    if (
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504
    ) {
        return "Máy chủ Gemini đang gặp sự cố. Vui lòng thử lại sau.";
    }

    if (message.includes("fetch failed")) {
        return "Không thể kết nối đến máy chủ Gemini.";
    }

    return message || "Đã xảy ra lỗi khi xử lý yêu cầu AI.";
};

// =====================================================
// 3. GỌI GEMINI CÓ THỬ LẠI
// =====================================================

const generateContentWithRetry = async (
    prompt,
    maxRetries = 2,
    options = {}
) => {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const model = getAI();

            const result = await model.generateContent({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }],
                    },
                ],
                generationConfig: {
                    temperature: 0.3,
                    ...options,
                },
            });

            const response = result.response;
            const text = response.text();

            if (!text || !text.trim()) {
                throw new Error("AI không trả về nội dung.");
            }

            return text.trim();
        } catch (error) {
            lastError = error;

            console.error(
                `Gemini error - lần ${attempt + 1}/${maxRetries + 1}:`,
                error.message
            );

            const status = error?.status || error?.statusCode;

            // Không thử lại với lỗi cấu hình hoặc yêu cầu không hợp lệ.
            if ([400, 401, 403, 404].includes(status)) {
                break;
            }

            if (attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    throw new Error(getGeminiErrorMessage(lastError));
};

// =====================================================
// 4. AI TỔNG HỢP NHIỀU TÀI LIỆU
// =====================================================

const askGemini = async (
    question,
    documentText,
    documentTitle = "Thư viện tài liệu"
) => {
    if (!question || !String(question).trim()) {
        throw new Error("Vui lòng nhập câu hỏi.");
    }

    if (!documentText || !String(documentText).trim()) {
        throw new Error("Không có nội dung tài liệu để phân tích.");
    }

    const prompt = `
Bạn là một trợ lý AI nghiên cứu và tổng hợp tài liệu chuyên sâu.

NHIỆM VỤ:
Trả lời câu hỏi dựa trên nội dung tài liệu được cung cấp.
Nội dung có thể bao gồm nhiều tài liệu khác nhau trong một thư viện.

TÊN TẬP TÀI LIỆU:
${documentTitle}

CÂU HỎI CỦA NGƯỜI DÙNG:
${question}

NỘI DUNG TÀI LIỆU:
${documentText}

==================================================
QUY TẮC PHÂN TÍCH
==================================================

1. Đọc và phân tích tất cả các nguồn tài liệu được cung cấp trước khi trả lời.

2. Nếu có nhiều tài liệu:
   - Tổng hợp thông tin từ các tài liệu liên quan.
   - So sánh những điểm giống và khác nhau.
   - Phân tích mối liên hệ giữa các nội dung.
   - Ưu tiên những thông tin có căn cứ rõ ràng.
   - Không chỉ dựa vào một tài liệu nếu các tài liệu khác cũng có thông tin liên quan.

3. Không được tự ý bịa đặt:
   - Số liệu.
   - Ngày tháng.
   - Tên văn bản.
   - Điều khoản.
   - Sự kiện.
   - Tên tác giả.
   - Số trang.
   - Nội dung trích dẫn.

4. Khi sử dụng thông tin, phải dẫn nguồn theo định dạng có trong dữ liệu, ví dụ:
   [NGUỒN 1 - Tên tài liệu - Trang 3]

5. Chỉ dẫn số trang nếu dữ liệu nguồn thực sự cung cấp số trang.
   Nếu không có số trang, chỉ ghi tên tài liệu.

6. Nếu các tài liệu có nội dung mâu thuẫn:
   - Nêu rõ sự khác biệt.
   - Chỉ ra tài liệu chứa thông tin tương ứng.
   - Không tự ý kết luận khi chưa đủ căn cứ.

7. Nếu dữ liệu không đủ để trả lời:
   - Nói rõ phần thông tin còn thiếu.
   - Không suy diễn thành sự thật.
   - Có thể đề xuất người dùng cung cấp thêm tài liệu.

==================================================
CÁCH TRÌNH BÀY
==================================================

Tùy câu hỏi, hãy trình bày theo cấu trúc phù hợp.

Đối với câu hỏi nghiên cứu hoặc tổng hợp chuyên sâu, ưu tiên:

1. Khái quát vấn đề.
2. Các nội dung chính.
3. Phân tích và tổng hợp từ các tài liệu.
4. So sánh, đánh giá.
5. Nhận xét và kết luận.
6. Danh mục nguồn tài liệu được sử dụng.

Sử dụng tiêu đề, đoạn văn và danh sách để nội dung dễ đọc.

Trả lời bằng tiếng Việt, rõ ràng, chính xác, có chiều sâu.
Không đưa ra thông tin không có căn cứ trong tài liệu.

BẮT ĐẦU PHÂN TÍCH VÀ TRẢ LỜI.
`;

    return await generateContentWithRetry(
        prompt,
        2,
        {
            temperature: 0.2,
        }
    );
};

// =====================================================
// 5. TẠO CÂU HỎI QUIZ TỪ TÀI LIỆU
// =====================================================

const generateQuizFromDocument = async (
    documentText,
    documentTitle,
    questionCount = 10
) => {
    if (!documentText || !String(documentText).trim()) {
        throw new Error("Không có nội dung tài liệu để tạo câu hỏi.");
    }

    questionCount = Number(questionCount);

    if (
        !Number.isInteger(questionCount) ||
        questionCount < 1 ||
        questionCount > 50
    ) {
        throw new Error("Số lượng câu hỏi phải từ 1 đến 50.");
    }

    const prompt = `
Bạn là chuyên gia xây dựng câu hỏi trắc nghiệm phục vụ học tập và kiểm tra kiến thức.

Hãy đọc kỹ tài liệu sau:

TÊN TÀI LIỆU:
${documentTitle || "Tài liệu học tập"}

NỘI DUNG:
${documentText}

YÊU CẦU:
Tạo chính xác ${questionCount} câu hỏi trắc nghiệm dựa trên tài liệu.

Mỗi câu hỏi phải:
- Có nội dung rõ ràng, không mơ hồ.
- Có đúng 4 phương án trả lời.
- Chỉ có 1 đáp án đúng.
- Có giải thích ngắn gọn vì sao đáp án đó đúng.
- Không tạo câu hỏi trùng lặp.
- Không sử dụng kiến thức bên ngoài nếu tài liệu không đề cập.
- Phân bổ câu hỏi từ nhận biết đến vận dụng.

CHỈ TRẢ VỀ JSON HỢP LỆ theo cấu trúc:

{
  "questions": [
    {
      "question": "Nội dung câu hỏi",
      "options": [
        "Phương án A",
        "Phương án B",
        "Phương án C",
        "Phương án D"
      ],
      "correctAnswer": 0,
      "explanation": "Giải thích đáp án"
    }
  ]
}

LƯU Ý:
- correctAnswer là chỉ số từ 0 đến 3.
- Không thêm Markdown.
- Không thêm nội dung bên ngoài JSON.
`;

    const rawResponse = await generateContentWithRetry(
        prompt,
        2,
        {
            temperature: 0.3,
            responseMimeType: "application/json",
        }
    );

    // Loại bỏ Markdown code fence nếu AI vô tình trả về.
    const cleanedResponse = rawResponse
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    let parsed;

    try {
        parsed = JSON.parse(cleanedResponse);
    } catch (error) {
        console.error("Gemini trả về JSON không hợp lệ:", rawResponse);
        throw new Error("AI trả về dữ liệu câu hỏi không đúng định dạng JSON.");
    }

    if (!parsed || !Array.isArray(parsed.questions)) {
        throw new Error("Dữ liệu Quiz không có danh sách câu hỏi hợp lệ.");
    }

    if (parsed.questions.length !== questionCount) {
        throw new Error(
            `AI tạo ${parsed.questions.length}/${questionCount} câu hỏi. Vui lòng thử lại.`
        );
    }

    const questions = parsed.questions.map((item, index) => {
        if (!item.question || !String(item.question).trim()) {
            throw new Error(`Câu hỏi ${index + 1} không có nội dung.`);
        }

        if (!Array.isArray(item.options) || item.options.length !== 4) {
            throw new Error(
                `Câu hỏi ${index + 1} phải có đúng 4 phương án.`
            );
        }

        const correctAnswer = Number(item.correctAnswer);

        if (
            !Number.isInteger(correctAnswer) ||
            correctAnswer < 0 ||
            correctAnswer > 3
        ) {
            throw new Error(
                `Câu hỏi ${index + 1} có đáp án đúng không hợp lệ.`
            );
        }

        return {
            question: String(item.question).trim(),
            options: item.options.map((option) => String(option).trim()),
            correctAnswer,
            explanation: String(item.explanation || "").trim(),
        };
    });

    return questions;
};

// =====================================================
// 6. EXPORT
// =====================================================

module.exports = {
    askGemini,
    generateQuizFromDocument,
};
