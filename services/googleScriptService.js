
const { google } = require("googleapis");

// ============================================
// GOOGLE OAUTH SCOPES
// ============================================

const SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/drive",
];

// ============================================
// OAUTH CLIENT
// ============================================

function createOAuthClient() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

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

async function exchangeCode(code) {
    const oauth2Client = createOAuthClient();

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
        throw new Error(
            "Google không cấp refresh token mới. Hãy ngắt kết nối và cấp quyền lại."
        );
    }

    oauth2Client.setCredentials(tokens);

    // Kiểm tra các quyền Google thực tế cấp
    const tokenInfo = await oauth2Client.getTokenInfo(
        tokens.access_token
    );

    console.log("Google OAuth scopes:", tokenInfo.scopes);

    const requiredScopes = [
        "https://www.googleapis.com/auth/script.projects",
        "https://www.googleapis.com/auth/script.deployments",
    ];

    const grantedScopes = tokenInfo.scopes || [];

    const missingScopes = requiredScopes.filter(
        scope => !grantedScopes.includes(scope)
    );

    if (missingScopes.length > 0) {
        throw new Error(
            `Google chưa cấp đủ quyền: ${missingScopes.join(", ")}`
        );
    }

    return {
        oauth2Client,
        tokens,
    };
}

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
// APPS SCRIPT CLIENT
// ============================================

function getAppsScript(oauth2Client) {
    return google.script({
        version: "v1",
        auth: oauth2Client,
    });
}

// ============================================
// TẠO PROJECT
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
// LƯU SOURCE CODE
// ============================================

async function saveGoogleProject(
    oauth2Client,
    scriptId,
    code,
    additionalFiles = []
) {
    const script = getAppsScript(oauth2Client);

    const files = [
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
        ...additionalFiles,
    ];

    const response = await script.projects.updateContent({
        scriptId,
        requestBody: {
            files,
        },
    });

    return response.data;
}

// ============================================
// LẤY NỘI DUNG PROJECT
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
// TẠO VERSION
// ============================================

async function createGoogleVersion(
    oauth2Client,
    scriptId,
    description = "Automatic version"
) {
    const script = getAppsScript(oauth2Client);

    const response = await script.projects.versions.create({
        scriptId,
        requestBody: {
            description,
        },
    });

    return response.data;
}

// ============================================
// TẠO API EXECUTABLE DEPLOYMENT
// ============================================

async function createGoogleDeployment(
    oauth2Client,
    scriptId,
    versionNumber
) {
    const script = getAppsScript(oauth2Client);

    const response = await script.projects.deployments.create({
        scriptId,
        requestBody: {
            versionNumber,
            description: "Automatic API Executable deployment",
        },
    });

    return response.data;
}

// ============================================
// CẬP NHẬT DEPLOYMENT
// ============================================

async function updateGoogleDeployment(
    oauth2Client,
    scriptId,
    deploymentId,
    versionNumber
) {
    const script = getAppsScript(oauth2Client);

    const response = await script.projects.deployments.update({
        scriptId,
        deploymentId,
        requestBody: {
            deploymentConfig: {
                scriptId,
                versionNumber,
                description: "Updated automatically",
            },
        },
    });

    return response.data;
}

// ============================================
// CHẠY FUNCTION
// ============================================

async function runGoogleScript(
    oauth2Client,
    deploymentId,
    functionName,
    parameters = []
) {
    if (!deploymentId) {
        throw new Error(
            "Project chưa có API Executable deployment."
        );
    }

    if (!functionName) {
        throw new Error("Tên function không hợp lệ.");
    }

    const script = getAppsScript(oauth2Client);

    const response = await script.scripts.run({
        scriptId: deploymentId,
        requestBody: {
            function: functionName,
            parameters,
        },
    });

    const result = response.data;

    if (result.error) {
        const detail = result.error.details?.[0];

        throw new Error(
            detail?.errorMessage ||
            result.error.message ||
            "Google Apps Script thực thi thất bại."
        );
    }

    if (result.done === false) {
        throw new Error(
            "Google chưa hoàn thành quá trình thực thi."
        );
    }

    return result.response?.result ?? null;
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

    createGoogleVersion,
    createGoogleDeployment,
    updateGoogleDeployment,
    runGoogleScript,
};
