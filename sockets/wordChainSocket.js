
const { randomInt } = require("crypto");
const wordChainService = require("../services/wordChainService");

module.exports = function registerWordChainSocket(io) {
    const rooms = new Map();

    // ==========================================
    // TẠO MÃ PHÒNG
    // ==========================================
    function makePin() {
        let pin;

        do {
            pin = String(randomInt(100000, 1000000));
        } while (rooms.has(pin));

        return pin;
    }

    // ==========================================
    // XÁO TRỘN MẢNG
    // ==========================================
    function shuffle(array) {
        const result = [...array];

        for (let i = result.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [result[i], result[j]] = [result[j], result[i]];
        }

        return result;
    }

    // ==========================================
    // DỮ LIỆU GỬI CHO NGƯỜI CHƠI
    // Không gửi đáp án đúng
    // ==========================================
    function getPublicGameData(room) {
        return {
            gameType: "MATCHING",
            title: room.title,
            questions: room.questions.map((question) => ({
                id: question.id,
                left_text: question.left_text,
            })),
            options: room.options.map((option) => ({
                option_key: option.option_key,
                right_text: option.right_text,
            })),
        };
    }

    // ==========================================
    // CẬP NHẬT DANH SÁCH NGƯỜI CHƠI
    // ==========================================
    function broadcastPlayers(room) {
        io.to(room.pin).emit("matching:room:players", {
            players: [...room.players.values()].map((player) => ({
                id: player.id,
                nickname: player.nickname,
                isHost: player.isHost,
                submitted: player.submitted,
            })),
        });
    }

    // ==========================================
    // KIỂM TRA ĐÁP ÁN PHÍA SERVER
    // ==========================================
    function calculateResult(room, answers) {
        let correct = 0;
        let wrong = 0;
        let unanswered = 0;

        const details = room.questions.map((question) => {
            const submittedKey = String(
                answers?.[question.id] ?? ""
            ).trim();

            const correctKey = String(
                question.correct_option_key
            );

            const isCorrect = submittedKey === correctKey;

            if (!submittedKey) {
                unanswered++;
            } else if (isCorrect) {
                correct++;
            } else {
                wrong++;
            }

            return {
                questionId: question.id,
                selectedOption: submittedKey || null,
                correct: isCorrect,
            };
        });

        return {
            correct,
            wrong,
            unanswered,
            total: room.questions.length,
            score: correct * 100,
            details,
        };
    }

    // ==========================================
    // SOCKET CONNECTION
    // ==========================================
    io.on("connection", (socket) => {

        // ======================================
        // 1. CHỦ PHÒNG TẠO PHÒNG GHÉP ĐÔI
        // ======================================
        socket.on(
            "matching:host:create",
            async ({ wordSetId } = {}, callback = () => {}) => {
                try {
                    if (!socket.data.userId) {
                        throw new Error("Socket chưa được xác thực");
                    }

                    if (!wordSetId) {
                        throw new Error("Vui lòng chọn bộ từ");
                    }

                    const wordSet =
                        await wordChainService.getWordSetForHost(wordSetId);

                    if (!wordSet) {
                        throw new Error("Không tìm thấy bộ dữ liệu");
                    }

                    if (wordSet.game_type !== "MATCHING") {
                        throw new Error(
                            "Bộ dữ liệu không đúng định dạng ghép đôi"
                        );
                    }

                    if (
                        !Array.isArray(wordSet.questions) ||
                        !wordSet.questions.length ||
                        !Array.isArray(wordSet.options) ||
                        !wordSet.options.length
                    ) {
                        throw new Error(
                            "Bộ dữ liệu chưa có câu hỏi hoặc đáp án"
                        );
                    }

                    const pin = makePin();

                    const questions = wordSet.questions.map((question) => ({
                        id: String(question.id),
                        left_text: question.left_text,
                        correct_option_key: String(
                            question.correct_option_key
                        ),
                    }));

                    const options = wordSet.options.map((option) => ({
                        option_key: String(option.option_key),
                        right_text: option.right_text,
                    }));

                    // Kiểm tra tính hợp lệ của đáp án
                    const optionKeys = new Set(
                        options.map((option) => option.option_key)
                    );

                    for (const question of questions) {
                        if (
                            question.correct_option_key !== "0" &&
                            !optionKeys.has(question.correct_option_key)
                        ) {
                            throw new Error(
                                `Câu hỏi ${question.id} có đáp án không hợp lệ`
                            );
                        }
                    }

                    const room = {
                        pin,
                        title: wordSet.title,
                        wordSetId,
                        hostSocketId: socket.id,
                        players: new Map(),
                        questions: shuffle(questions),
                        options: shuffle(options),
                        started: false,
                        finished: false,
                    };

                    rooms.set(pin, room);

                    socket.join(pin);
                    socket.data.matchingHostPin = pin;

                    callback({
                        ok: true,
                        pin,
                        title: room.title,
                    });

                } catch (error) {
                    console.error(
                        "[MATCHING] Create room error:",
                        error
                    );

                    callback({
                        ok: false,
                        message: error.message,
                    });
                }
            }
        );

        // ======================================
        // 2. NGƯỜI CHƠI THAM GIA
        // ======================================
        socket.on(
            "matching:player:join",
            ({ pin, nickname } = {}, callback = () => {}) => {
                pin = String(pin || "").trim();
                nickname = String(nickname || "")
                    .trim()
                    .slice(0, 20);

                const room = rooms.get(pin);

                if (!room) {
                    return callback({
                        ok: false,
                        message: "Mã phòng không tồn tại",
                    });
                }

                if (room.started) {
                    return callback({
                        ok: false,
                        message: "Trận đấu đã bắt đầu",
                    });
                }

                if (!nickname) {
                    return callback({
                        ok: false,
                        message: "Vui lòng nhập nickname",
                    });
                }

                const player = {
                    id: socket.id,
                    nickname,
                    isHost: false,
                    submitted: false,
                    score: 0,
                    result: null,
                };

                room.players.set(socket.id, player);

                socket.join(pin);
                socket.data.matchingPlayerPin = pin;

                broadcastPlayers(room);

                callback({
                    ok: true,
                    pin,
                    playerId: socket.id,
                    nickname,
                });
            }
        );

        // ======================================
        // 3. CHỦ PHÒNG BẮT ĐẦU TRẬN
        // ======================================
        socket.on(
            "matching:host:start",
            ({ pin } = {}, callback = () => {}) => {
                const room = rooms.get(String(pin || ""));

                if (
                    !room ||
                    room.hostSocketId !== socket.id
                ) {
                    return callback({
                        ok: false,
                        message: "Không có quyền điều khiển phòng",
                    });
                }

                if (room.started) {
                    return callback({
                        ok: false,
                        message: "Trận đấu đã bắt đầu",
                    });
                }

                if (room.players.size < 1) {
                    return callback({
                        ok: false,
                        message: "Cần ít nhất một người chơi",
                    });
                }

                room.started = true;

                io.to(room.pin).emit(
                    "matching:game:started",
                    {
                        ...getPublicGameData(room),
                        totalQuestions: room.questions.length,
                        totalOptions: room.options.length,
                    }
                );

                callback({ ok: true });
            }
        );

        // ======================================
        // 4. NGƯỜI CHƠI GỬI KẾT QUẢ GHÉP ĐÔI
        // ======================================
        socket.on(
            "matching:player:submit",
            ({ pin, answers } = {}, callback = () => {}) => {
                const room = rooms.get(String(pin || ""));
                const playerId = socket.id;

                if (
                    !room ||
                    socket.data.matchingPlayerPin !== room.pin ||
                    !room.started ||
                    room.finished
                ) {
                    return callback({
                        ok: false,
                        message: "Không thể gửi kết quả",
                    });
                }

                const player = room.players.get(playerId);

                if (!player) {
                    return callback({
                        ok: false,
                        message: "Bạn không thuộc phòng này",
                    });
                }

                if (player.submitted) {
                    return callback({
                        ok: false,
                        message: "Bạn đã nộp bài rồi",
                    });
                }

                if (
                    !answers ||
                    typeof answers !== "object" ||
                    Array.isArray(answers)
                ) {
                    return callback({
                        ok: false,
                        message: "Dữ liệu ghép đôi không hợp lệ",
                    });
                }

                const validQuestionIds = new Set(
                    room.questions.map((question) => question.id)
                );

                const validOptionKeys = new Set(
                    room.options.map((option) => option.option_key)
                );

                // Chỉ chấp nhận các câu hỏi và đáp án có trong bộ dữ liệu
                for (const [questionId, optionKey] of Object.entries(answers)) {
                    if (!validQuestionIds.has(String(questionId))) {
                        return callback({
                            ok: false,
                            message: "Có câu hỏi không hợp lệ",
                        });
                    }

                    const selected = String(optionKey);

                    if (
                        selected !== "0" &&
                        !validOptionKeys.has(selected)
                    ) {
                        return callback({
                            ok: false,
                            message: "Có đáp án không hợp lệ",
                        });
                    }
                }

                const result = calculateResult(room, answers);

                player.submitted = true;
                player.score = result.score;
                player.result = result;

                // Người chơi chỉ nhận kết quả của chính mình
                callback({
                    ok: true,
                    result: {
                        correct: result.correct,
                        wrong: result.wrong,
                        unanswered: result.unanswered,
                        total: result.total,
                        score: result.score,
                    },
                });

                // Chủ phòng nhận thông báo đã nộp
                io.to(room.hostSocketId).emit(
                    "matching:host:submission",
                    {
                        playerId,
                        nickname: player.nickname,
                        submitted: true,
                    }
                );

                broadcastPlayers(room);

                // Tất cả người chơi đã nộp thì tự động kết thúc
                const allSubmitted = [...room.players.values()].every(
                    (item) => item.submitted
                );

                if (allSubmitted) {
                    finishGame(room);
                }
            }
        );

        // ======================================
        // 5. KẾT THÚC TRẬN ĐẤU
        // ======================================
        function finishGame(room) {
            if (room.finished) return;

            room.finished = true;

            const leaderboard = [...room.players.values()]
                .map((player) => ({
                    id: player.id,
                    nickname: player.nickname,
                    score: player.score,
                    submitted: player.submitted,
                    result: player.result
                        ? {
                            correct: player.result.correct,
                            wrong: player.result.wrong,
                            unanswered: player.result.unanswered,
                            total: player.result.total,
                        }
                        : null,
                }))
                .sort((a, b) => b.score - a.score);

            // Chỉ chủ phòng nhận đáp án chuẩn để hiển thị
            io.to(room.hostSocketId).emit(
                "matching:host:answer-key",
                {
                    answers: Object.fromEntries(
                        room.questions.map((question) => [
                            question.id,
                            question.correct_option_key,
                        ])
                    ),
                }
            );

            io.to(room.pin).emit(
                "matching:game:finished",
                { leaderboard }
            );
        }

        // ======================================
        // 6. CHỦ PHÒNG CHỦ ĐỘNG KẾT THÚC
        // ======================================
        socket.on(
            "matching:host:finish",
            ({ pin } = {}, callback = () => {}) => {
                const room = rooms.get(String(pin || ""));

                if (
                    !room ||
                    room.hostSocketId !== socket.id
                ) {
                    return callback({
                        ok: false,
                        message: "Không có quyền kết thúc trận",
                    });
                }

                finishGame(room);
                callback({ ok: true });
            }
        );

        // ======================================
        // 7. RỜI PHÒNG
        // ======================================
        socket.on(
            "matching:player:leave",
            ({ pin } = {}, callback = () => {}) => {
                const room = rooms.get(String(pin || ""));
                
                if (!room) {
                    socket.data.matchingPlayerPin = null;
                    return callback({ ok: true });
                }

                if (room.players.has(socket.id)) {
                    room.players.delete(socket.id);
                    socket.leave(room.pin);
                    broadcastPlayers(room);
                }

                socket.data.matchingPlayerPin = null;
                callback({ ok: true });
            }
        );

        // ======================================
        // 8. CHỦ PHÒNG ĐÓNG PHÒNG
        // ======================================
        socket.on(
            "matching:host:close",
            ({ pin } = {}, callback = () => {}) => {
                const room = rooms.get(String(pin || ""));

                if (
                    !room ||
                    room.hostSocketId !== socket.id
                ) {
                    return callback({
                        ok: false,
                        message: "Không có quyền đóng phòng",
                    });
                }

                io.to(room.pin).emit(
                    "matching:room:closed",
                    {
                        message: "Chủ phòng đã đóng phòng",
                    }
                );

                rooms.delete(room.pin);

                callback({ ok: true });
            }
        );

        // ======================================
        // 9. DISCONNECT
        // ======================================
        socket.on("disconnect", () => {
            const playerPin = socket.data.matchingPlayerPin;
            const playerRoom = rooms.get(playerPin);

            if (playerRoom && playerRoom.players.has(socket.id)) {
                playerRoom.players.delete(socket.id);
                broadcastPlayers(playerRoom);
            }

            const hostPin = socket.data.matchingHostPin;
            const hostRoom = rooms.get(hostPin);

            if (hostRoom && hostRoom.hostSocketId === socket.id) {
                io.to(hostRoom.pin).emit(
                    "matching:room:closed",
                    {
                        message: "Chủ phòng đã mất kết nối",
                    }
                );

                rooms.delete(hostRoom.pin);
            }
        });
    });
};
