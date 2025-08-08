"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMongoDBCommands = void 0;
const vscode = require("vscode");
const mongodb_1 = require("mongodb");
const webviewPanel_1 = require("./webviewPanel");
const path = require("path");
let client;
let db;
let currentCollection = null;
// Configuration for pagination
const DOCUMENTS_PER_PAGE = 10;
function registerMongoDBCommands(context) {
    const connectDisposable = vscode.commands.registerCommand("sayaib.hue-console.connectMongoDB", () => __awaiter(this, void 0, void 0, function* () {
        showMongoDBWebView(context);
    }));
    context.subscriptions.push(connectDisposable);
}
exports.registerMongoDBCommands = registerMongoDBCommands;
function showMongoDBWebView(context) {
    const panel = vscode.window.createWebviewPanel("mongoDBWebView", "MongoDB Viewer", vscode.ViewColumn.One, { enableScripts: true });
    const iconPath = path.resolve(context.extensionPath, "logo.png");
    panel.iconPath = vscode.Uri.file(iconPath);
    panel.webview.html = (0, webviewPanel_1.getWebviewContent)();
    panel.webview.onDidReceiveMessage((message) => __awaiter(this, void 0, void 0, function* () {
        if (message.command === "fetchCollections") {
            if (!db) {
                panel.webview.postMessage({
                    command: "error",
                    message: "Not connected to MongoDB",
                });
                return;
            }
            try {
                const collections = yield db.listCollections().toArray();
                panel.webview.postMessage({
                    command: "collections",
                    data: collections.map((col) => col.name),
                });
            }
            catch (error) {
                panel.webview.postMessage({
                    command: "error",
                    message: error,
                });
            }
        }
        if (message.command === "fetchDocuments") {
            currentCollection = message.collection;
            const page = message.page || 1; // Default to page 1
            const searchTerm = message.searchTerm || ""; // Default to empty search
            if (!db) {
                panel.webview.postMessage({
                    command: "error",
                    message: "Not connected to MongoDB",
                });
                return;
            }
            try {
                const collection = db.collection(message.collection);
                // Build the query dynamically based on the search term
                let query = {};
                if (searchTerm) {
                    // Fetch one document to get the field names
                    const sampleDocument = yield collection.findOne({});
                    if (sampleDocument) {
                        const fields = Object.keys(sampleDocument);
                        const searchConditions = fields.map((field) => ({
                            [field]: { $regex: searchTerm, $options: "i" }, // Case-insensitive regex search
                        }));
                        query = { $or: searchConditions };
                    }
                }
                // Calculate skip value for pagination
                const skip = (page - 1) * DOCUMENTS_PER_PAGE;
                // Fetch documents with pagination and search
                const documents = yield collection
                    .find(query)
                    .skip(skip)
                    .limit(DOCUMENTS_PER_PAGE)
                    .toArray();
                // Get total count of documents for pagination
                const totalDocuments = yield collection.countDocuments(query);
                const totalPages = Math.ceil(totalDocuments / DOCUMENTS_PER_PAGE);
                panel.webview.postMessage({
                    command: "documents",
                    data: documents,
                    page: page,
                    totalPages: totalPages,
                    searchTerm: searchTerm,
                });
            }
            catch (error) {
                panel.webview.postMessage({
                    command: "error",
                    message: error,
                });
            }
        }
        if (message.command === "updateDocument") {
            if (!db) {
                panel.webview.postMessage({
                    command: "error",
                    message: "Not connected to MongoDB",
                });
                return;
            }
            const collection = db.collection(currentCollection || "defaultCollection");
            try {
                try {
                    // Convert the docId to ObjectId
                    const docId = new mongodb_1.ObjectId(message.docId); // Ensure it's converted to ObjectId
                    // Fetch documents to check the initial state
                    const documents = yield collection.find({}).limit(10).toArray();
                    // Ensure that the docId exists in the collection
                    const existingDoc = yield collection.findOne({ _id: docId });
                    if (!existingDoc) {
                        console.error("Document with _id not found:", docId);
                        panel.webview.postMessage({
                            command: "error",
                            message: `Document with _id ${docId} not found`,
                        });
                        return;
                    }
                    // Remove _id from updatedDoc if it exists (avoid replacing _id)
                    const _a = message.updatedDoc, { _id } = _a, updatedDocWithoutId = __rest(_a, ["_id"]);
                    // Perform the update operation with the provided updated document
                    const result = yield collection.replaceOne({ _id: docId }, // Filter by _id
                    updatedDocWithoutId // Replace the entire document, excluding the _id field
                    );
                    // Check if the document was updated
                    if (result.modifiedCount > 0) {
                        panel.webview.postMessage({
                            command: "success",
                            message: "Document updated successfully",
                        });
                        // Refresh the document list after update
                        const updatedDocuments = yield collection
                            .find()
                            .limit(10)
                            .toArray();
                        panel.webview.postMessage({
                            command: "documents",
                            data: updatedDocuments,
                        });
                    }
                    else {
                        console.log("No changes made to the document");
                        panel.webview.postMessage({
                            command: "error",
                            message: "No changes were made to the document",
                        });
                    }
                }
                catch (error) {
                    console.error("Error occurred during the update:", error);
                    panel.webview.postMessage({
                        command: "error",
                        message: `Error occurred: ${error}`,
                    });
                }
            }
            catch (error) {
                panel.webview.postMessage({
                    command: "error",
                    message: error,
                });
            }
        }
        if (message.command === "connectMongoDB") {
            const uri = message.uri;
            if (!uri) {
                panel.webview.postMessage({
                    command: "error",
                    message: "MongoDB URI is required",
                });
                return;
            }
            try {
                client = new mongodb_1.MongoClient(uri);
                yield client.connect();
                db = client.db();
                panel.webview.postMessage({
                    command: "success",
                    message: "Connected to MongoDB",
                });
                // Fetch collections after connecting
                const collections = yield db.listCollections().toArray();
                panel.webview.postMessage({
                    command: "collections",
                    data: collections.map((col) => col.name),
                });
            }
            catch (error) {
                panel.webview.postMessage({
                    command: "error",
                    message: `Failed to connect to MongoDB: ${error}`,
                });
            }
        }
    }), undefined, context.subscriptions);
}
//# sourceMappingURL=mongoDBCommands.js.map