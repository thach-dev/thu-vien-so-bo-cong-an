
const { randomInt } = require("crypto");
const quizService = require("../services/quizService");

module.exports = function registerQuizSocket(io) {
  const rooms = new Map();

  function makePin() {
    let pin;

    do {
      pin = String(randomInt(100000, 1000000));
    } while (rooms.has(pin));

    return pin;
  }

  io.on("connection", (socket) => {
    socket.on("host:create", async ({ quizId } = {}, callback = () => {}) => {
      try {
        // TODO: Xác thực socket và xác minh chủ sở hữu quiz trước khi mở cho production.
        if (!quizId) throw new Error("Thiếu quizId");

        const quiz = await quizService.getQuizForHost(
          quizId,
          socket.data.userId
        );

        if (!socket.data.userId) {
          throw new Error("Socket chưa được xác thực");
        }

        const pin = makePin();

        rooms.set(pin, {
          pin,
          quiz,
          hostSocketId: socket.id,
          players: new Map(),
          currentIndex: -1,
          currentQuestion: null,
          answers: new Map(),
          started: false,
        });

        socket.join(pin);
        socket.data.hostPin = pin;

        callback({ ok: true, pin });
      } catch (error) {
        callback({ ok: false, message: error.message });
      }
    });

    socket.on("player:join", ({ pin, nickname } = {}, callback = () => {}) => {
      pin = String(pin || "");
      nickname = String(nickname || "").trim().slice(0, 20);

      const room = rooms.get(pin);

      if (!room) {
        return callback({ ok: false, message: "Mã phòng không tồn tại" });
      }

      if (room.started) {
        return callback({ ok: false, message: "Ván chơi đã bắt đầu" });
      }

      if (!nickname) {
        return callback({ ok: false, message: "Vui lòng nhập nickname" });
      }

      const playerId = socket.id;

      room.players.set(playerId, {
        id: playerId,
        nickname,
        score: 0,
      });

      socket.join(pin);
      socket.data.playerPin = pin;
      socket.data.playerId = playerId;

      io.to(pin).emit("room:players", {
        players: [...room.players.values()],
      });

      callback({
        ok: true,
        pin,
        playerId,
        nickname,
      });
    });

    socket.on("host:start", ({ pin } = {}, callback = () => {}) => {
      const room = rooms.get(String(pin || ""));

      if (!room || room.hostSocketId !== socket.id) {
        return callback({ ok: false, message: "Không có quyền điều khiển phòng" });
      }

      if (room.started) {
        return callback({ ok: false, message: "Ván chơi đã bắt đầu" });
      }

      room.started = true;
      callback({ ok: true });

      io.to(room.pin).emit("game:started", {
        totalQuestions: room.quiz.questions.length,
      });
    });

    socket.on("host:next-question", ({ pin } = {}, callback = () => {}) => {
      const room = rooms.get(String(pin || ""));

      if (!room || room.hostSocketId !== socket.id || !room.started) {
        return callback({ ok: false, message: "Không thể chuyển câu hỏi" });
      }

      room.currentIndex += 1;

      if (room.currentIndex >= room.quiz.questions.length) {
        io.to(room.pin).emit("game:finished", {
          leaderboard: [...room.players.values()].sort(
            (a, b) => b.score - a.score
          ),
        });

        rooms.delete(room.pin);
        return callback({ ok: true, finished: true });
      }

      const q = room.quiz.questions[room.currentIndex];

      room.currentQuestion = q;
      room.answers.clear();

      // Chỉ phát nội dung câu hỏi, không phát đáp án đúng.
      io.to(room.pin).emit("question:show", {
        index: room.currentIndex + 1,
        total: room.quiz.questions.length,
        id: q.id,
        question_text: q.question_text,
        answers: q.answers,
        time_limit: q.time_limit,
      });

      callback({ ok: true, index: room.currentIndex + 1 });
    });

    socket.on("player:answer", ({ pin, answerIndex } = {}, callback = () => {}) => {
      const room = rooms.get(String(pin || ""));
      const playerId = socket.data.playerId;

      if (
        !room ||
        socket.data.playerPin !== room.pin ||
        !room.currentQuestion ||
        !room.players.has(playerId)
      ) {
        return callback({ ok: false, message: "Không thể gửi đáp án" });
      }

      if (
        !Number.isInteger(answerIndex) ||
        answerIndex < 0 ||
        answerIndex > 3
      ) {
        return callback({ ok: false, message: "Đáp án không hợp lệ" });
      }

      if (room.answers.has(playerId)) {
        return callback({ ok: false, message: "Bạn đã trả lời câu này rồi" });
      }

      const q = room.currentQuestion;
      const correct = answerIndex === q.correct_answer;
      const player = room.players.get(playerId);

      room.answers.set(playerId, {
        answerIndex,
        correct,
      });

      if (correct) {
        player.score += Number(q.points) || 1000;
      }

      callback({ ok: true, correct });

      io.to(room.pin).emit("answer:count", {
        count: room.answers.size,
        totalPlayers: room.players.size,
      });

      io.to(room.hostSocketId).emit("host:answer-received", {
        playerId,
        nickname: player.nickname,
        correct,
      });
    });

    socket.on("host:reveal-answer", ({ pin } = {}, callback = () => {}) => {
      const room = rooms.get(String(pin || ""));

      if (!room || room.hostSocketId !== socket.id || !room.currentQuestion) {
        return callback({ ok: false, message: "Không thể công bố đáp án" });
      }

      io.to(room.pin).emit("question:result", {
        correct_answer: room.currentQuestion.correct_answer,
        leaderboard: [...room.players.values()].sort(
          (a, b) => b.score - a.score
        ),
      });

      callback({ ok: true });
    });

    socket.on("disconnect", () => {
      const pin = socket.data.playerPin;
      const room = rooms.get(pin);

      if (room && room.players.has(socket.id)) {
        room.players.delete(socket.id);

        io.to(pin).emit("room:players", {
          players: [...room.players.values()],
        });
      }

      // Nếu host ngắt kết nối, phòng sẽ được dọn khi triển khai cơ chế timeout.
    });
  });
};
