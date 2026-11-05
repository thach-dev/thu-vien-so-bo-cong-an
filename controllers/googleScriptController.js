const crypto = require("crypto");

const supabase = require("../config/supabase");

const {
    encrypt,
    decrypt,
} = require("../utils/tokenEncryption");

const {
    generateAuthUrl,
    exchangeCode,
    getGoogleUser,
    createGoogleProject,
    saveGoogleProject,
} = require("../services/googleScriptService");

const { google } = require("googleapis");

// Hàm hỗ trợ tự động nhận diện domain (Localhost hoặc Vercel Production)
const getFrontendUrl = (req) => {
    const origin = req.get("origin") || req.get("referer");
    if (origin && origin.includes("localhost")) {
        try {
            const urlObj = new URL(origin);
            return `${urlObj.protocol}//${urlObj.host}`;
        } catch (e) {
            // Bỏ qua nếu parse lỗi
        }
    }
    return process.env.FRONTEND_URL || "https://thu-vien-so-bo-cong-an.vercel.app";
};

// ============================================
// LẤY OAUTH URL
// ============================================

exports.connectGoogle = async (req, res) => {
    try {
        const userId = req.user.id;

        const state = crypto.randomBytes(32).toString("hex");

        const expiresAt = new Date(
            Date.now() + 10 * 60 * 1000
        ).toISOString();

        const { error } = await supabase
            .from("google_oauth_states")
            .insert({
                state,
                user_id: userId,
                expires_at: expiresAt,
            });

        if (error) throw error;

        const url = generateAuthUrl(state);

        return res.json({
            success: true,
            url,
        });
    } catch (error) {
        console.error("Connect Google:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể tạo liên kết Google OAuth",
        });
    }
};

// ============================================
// GOOGLE CALLBACK
// ============================================

exports.googleCallback = async (req, res) => {
    const FRONTEND_URL = getFrontendUrl(req);

    try {
        const { code, state, error } = req.query;

        if (error) {
            return res.redirect(
                `${FRONTEND_URL}/script-ide?google=denied`
            );
        }

        if (!code || !state) {
            return res.status(400).send(
                "Thiếu code hoặc state OAuth"
            );
        }

        const { data: stateData, error: stateError } =
            await supabase
                .from("google_oauth_states")
                .select("*")
                .eq("state", state)
                .single();

        if (stateError || !stateData) {
            return res.status(400).send(
                "OAuth state không hợp lệ"
            );
        }

        // Xóa state ngay khi sử dụng để chống replay
        const { error: deleteError } = await supabase
            .from("google_oauth_states")
            .delete()
            .eq("state", state);

        if (deleteError) throw deleteError;

        if (new Date(stateData.expires_at).getTime() < Date.now()) {
            return res.status(400).send(
                "OAuth state đã hết hạn"
            );
        }

        const { oauth2Client, tokens } =
            await exchangeCode(code);

        const googleUser = await getGoogleUser(oauth2Client);

        const { data: existing } = await supabase
            .from("google_connections")
            .select("refresh_token")
            .eq("user_id", stateData.user_id)
            .maybeSingle();

        const refreshToken =
            tokens.refresh_token
                ? encrypt(tokens.refresh_token)
                : existing?.refresh_token;

        if (!refreshToken) {
            return res.redirect(
                `${FRONTEND_URL}/script-ide?google=token_missing`
            );
        }

        const { error: saveError } = await supabase
            .from("google_connections")
            .upsert(
                {
                    user_id: stateData.user_id,
                    google_user_id: googleUser.id,
                    google_email: googleUser.email,
                    refresh_token: refreshToken,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: "user_id",
                }
            );

        if (saveError) throw saveError;

        return res.redirect(
            `${FRONTEND_URL}/script-ide?google=connected`
        );
    } catch (error) {
        console.error("Google callback:", error);

        return res.redirect(
            `${FRONTEND_URL}/script-ide?google=failed`
        );
    }
};

// ============================================
// LẤY GOOGLE CLIENT CỦA NGƯỜI DÙNG
// ============================================

async function getUserGoogleClient(userId) {
    const { data, error } = await supabase
        .from("google_connections")
        .select("*")
        .eq("user_id", userId)
        .single();

    if (error || !data) {
        throw new Error("Bạn chưa kết nối tài khoản Google");
    }

    const refreshToken = decrypt(data.refresh_token);

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
        refresh_token: refreshToken,
    });

    return {
        oauth2Client,
        connection: data,
    };
}

// ============================================
// KIỂM TRA GOOGLE ĐÃ KẾT NỐI CHƯA
// ============================================

exports.getGoogleStatus = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("google_connections")
            .select("google_email")
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (error) throw error;

        return res.json({
            success: true,
            connected: !!data,
            email: data?.google_email || null,
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Không thể kiểm tra trạng thái Google",
        });
    }
};

// ============================================
// TẠO GOOGLE APPS SCRIPT PROJECT
// ============================================

exports.createProject = async (req, res) => {
    try {
        const userId = req.user.id;

        const title =
            String(req.body.title || "Untitled Project").trim();

        if (!title || title.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Tên project không hợp lệ",
            });
        }

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        const project = await createGoogleProject(
            oauth2Client,
            title
        );

        if (!project.scriptId) {
            throw new Error("Google không trả về scriptId");
        }

        // Khởi tạo file nguồn ban đầu
        await saveGoogleProject(
            oauth2Client,
            project.scriptId,
            'function myFunction() {\n  Logger.log("Hello World");\n}'
        );

        const { data, error } = await supabase
            .from("script_projects")
            .insert({
                user_id: userId,
                google_script_id: project.scriptId,
                title,
            })
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({
            success: true,
            project: data,
        });
    } catch (error) {
        console.error("Create project:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Không thể tạo project",
        });
    }
};

// ============================================
// LƯU CODE LÊN GOOGLE
// ============================================

exports.saveProject = async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.id;

        const code = req.body.code;

        if (typeof code !== "string") {
            return res.status(400).json({
                success: false,
                message: "Code không hợp lệ",
            });
        }

        const { data: project, error } = await supabase
            .from("script_projects")
            .select("*")
            .eq("id", projectId)
            .eq("user_id", userId)
            .single();

        if (error || !project) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy project",
            });
        }

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        await saveGoogleProject(
            oauth2Client,
            project.google_script_id,
            code
        );

        await supabase
            .from("script_projects")
            .update({
                updated_at: new Date().toISOString(),
            })
            .eq("id", projectId)
            .eq("user_id", userId);

        return res.json({
            success: true,
            message: "Đã lưu code lên Google Apps Script",
        });
    } catch (error) {
        console.error("Save project:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Không thể lưu project",
        });
    }
};

// ============================================
// DANH SÁCH PROJECT CỦA NGƯỜI DÙNG
// ============================================

exports.getProjects = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("script_projects")
            .select("*")
            .eq("user_id", req.user.id)
            .order("created_at", {
                ascending: false,
            });

        if (error) throw error;

        return res.json({
            success: true,
            projects: data || [],
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Không thể lấy danh sách project",
        });
    }
};

// ============================================
// NGẮT KẾT NỐI GOOGLE
// ============================================

exports.disconnectGoogle = async (req, res) => {
    try {
        const { error } = await supabase
            .from("google_connections")
            .delete()
            .eq("user_id", req.user.id);

        if (error) throw error;

        return res.json({
            success: true,
            message: "Đã ngắt kết nối Google",
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Không thể ngắt kết nối Google",
        });
    }
};

// ============================================
// LẤY NỘI DUNG PROJECT GOOGLE
// ============================================
exports.getProjectContent = async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.id;

        const { data: project, error } = await supabase
            .from("script_projects")
            .select("*")
            .eq("id", projectId)
            .eq("user_id", userId)
            .single();

        if (error || !project) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy project",
            });
        }

        const { oauth2Client } = await getUserGoogleClient(userId);

        const files = await getGoogleProjectContent(
            oauth2Client,
            project.google_script_id
        );

        return res.json({
            success: true,
            files,
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};