
require("dotenv").config();

const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function main() {
  try {
    const result = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "user",
          content:
            "Hãy trả lời bằng tiếng Việt: Xin chào, bạn là AI gì?",
        },
      ],
    });

    console.log(
      result.choices[0].message.content
    );
  } catch (error) {
    console.error("Groq API lỗi:", error.status);
    console.error(error.message);
  }
}

main();
