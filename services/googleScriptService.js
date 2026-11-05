
const { google } = require("googleapis");

// ============================================
// GOOGLE OAUTH SCOPES
// ============================================

const SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/script.projects",
];

// ============================================
// TẠO OAUTH CLIENT
// ============================================

function createOAuthClient() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

// ============================================
// TẠO GOOGLE AUTH URL
// ============================================

function generateAuthUrl(state) {
    const oauth2Client = createOAuthClient();

    return oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        response_type: "code",
        include_granted_scopes: true,
        scope: SCOPES,
        state,
    });
}

// ============================================
// ĐỔI CODE LẤY TOKEN
// ============================================

async function exchangeCode(code) {
    const oauth2Client = createOAuthClient();

    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    return {
        oauth2Client,
        tokens,
    };
}

// ============================================
// LẤY THÔNG TIN TÀI KHOẢN GOOGLE
// ============================================

async function getGoogleUser(oauth2Client) {
    const oauth2 = google.oauth2({
        auth: oauth2Client,
        version: "v2",
    });

    const { data } = await oauth2.userinfo.get();

    return {
        id: data.id,
        email: data.email,
    };
}

// ============================================
// GOOGLE APPS SCRIPT API
// ============================================

function getAppsScript(oauth2Client) {
    return google.script({
        version: "v1",
        auth: oauth2Client,
    });
}

// ============================================
// TẠO GOOGLE APPS SCRIPT PROJECT
// ============================================

async function createGoogleProject(oauth2Client, title) {
    const script = getAppsScript(oauth2Client);

    const response = await script.projects.create({
        requestBody: {
            title,
        },
    });

    return response.data;
}

// ============================================
// LƯU CODE LÊN GOOGLE APPS SCRIPT
// ============================================

async function saveGoogleProject(
    oauth2Client,
    scriptId,
    code
) {
    const script = getAppsScript(oauth2Client);

    const response = await script.projects.updateContent({
        scriptId,
        requestBody: {
            files: [
                {
                    name: "Code",
                    type: "SERVER_JS",
                    source: code,
                },
                {
                    name: "appsscript",
                    type: "JSON",
                    source: JSON.stringify({
                        timeZone: "Asia/Ho_Chi_Minh",
                        exceptionLogging: "STACKDRIVER",
                        runtimeVersion: "V8",
                    }),
                },
            ],
        },
    });

    return response.data;
}

// ============================================
// LẤY NỘI DUNG GOOGLE APPS SCRIPT PROJECT
// ============================================

async function getGoogleProjectContent(
    oauth2Client,
    scriptId
) {
    const script = getAppsScript(oauth2Client);

    const response = await script.projects.getContent({
        scriptId,
    });

    return response.data.files || [];
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    generateAuthUrl,
    exchangeCode,
    getGoogleUser,
    createGoogleProject,
    saveGoogleProject,
    getGoogleProjectContent,
};
