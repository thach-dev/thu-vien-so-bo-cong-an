const { google } = require("googleapis");

const SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/script.projects",
];

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
        scope: SCOPES,
        state,
    });
}

async function exchangeCode(code) {
    const oauth2Client = createOAuthClient();

    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

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

function getAppsScript(oauth2Client) {
    return google.script({
        version: "v1",
        auth: oauth2Client,
    });
}

async function createGoogleProject(oauth2Client, title) {
    const script = getAppsScript(oauth2Client);

    const response = await script.projects.create({
        requestBody: {
            title,
        },
    });

    return response.data;
}

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
async function getGoogleProjectContent(oauth2Client, scriptId) {
    const script = getAppsScript(oauth2Client);

    const response = await script.projects.getContent({
        scriptId,
    });

    return response.data.files || [];
}

module.exports = {
    generateAuthUrl,
    getGoogleProjectContent,
    exchangeCode,
    getGoogleUser,
    createGoogleProject,
    saveGoogleProject,
};