import * as vscode from "vscode";
import { MongoClient, Db, Collection, ObjectId } from "mongodb";
import { getWebviewContent } from "./webviewPanel";
import * as path from "path";

let client: MongoClient;
let db: Db;
let currentCollection: string | null = null;

// Configuration for pagination
const DOCUMENTS_PER_PAGE = 10;

export function registerMongoDBCommands(context: vscode.ExtensionContext) {
  const connectDisposable = vscode.commands.registerCommand(
    "sayaib.hue-console.connectMongoDB",
    async () => {
      showMongoDBWebView(context);
    }
  );

  context.subscriptions.push(connectDisposable);
}

function showMongoDBWebView(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    "mongoDBWebView",
    "MongoDB Viewer",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const iconPath = path.resolve(context.extensionPath, "logo.png");
  panel.iconPath = vscode.Uri.file(iconPath);
  panel.webview.html = getWebviewContent();

  panel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.command === "fetchCollections") {
        if (!db) {
          panel.webview.postMessage({
            command: "error",
            message: "Not connected to MongoDB",
          });
          return;
        }

        try {
          const collections = await db.listCollections().toArray();
          panel.webview.postMessage({
            command: "collections",
            data: collections.map((col) => col.name),
          });
        } catch (error) {
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
          const collection: Collection = db.collection(message.collection);

          // Build the query dynamically based on the search term
          let query = {};
          if (searchTerm) {
            // Fetch one document to get the field names
            const sampleDocument = await collection.findOne({});
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
          const documents = await collection
            .find(query)
            .skip(skip)
            .limit(DOCUMENTS_PER_PAGE)
            .toArray();

          // Get total count of documents for pagination
          const totalDocuments = await collection.countDocuments(query);
          const totalPages = Math.ceil(totalDocuments / DOCUMENTS_PER_PAGE);

          panel.webview.postMessage({
            command: "documents",
            data: documents,
            page: page,
            totalPages: totalPages,
            searchTerm: searchTerm,
          });
        } catch (error) {
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

        const collection = db.collection(
          currentCollection || "defaultCollection"
        );

        try {
          try {
            // Convert the docId to ObjectId
            const docId = new ObjectId(message.docId); // Ensure it's converted to ObjectId

            // Fetch documents to check the initial state
            const documents = await collection.find({}).limit(10).toArray();

            // Ensure that the docId exists in the collection
            const existingDoc = await collection.findOne({ _id: docId });
            if (!existingDoc) {
              console.error("Document with _id not found:", docId);
              panel.webview.postMessage({
                command: "error",
                message: `Document with _id ${docId} not found`,
              });
              return;
            }

            // Remove _id from updatedDoc if it exists (avoid replacing _id)
            const { _id, ...updatedDocWithoutId } = message.updatedDoc;

            // Perform the update operation with the provided updated document
            const result = await collection.replaceOne(
              { _id: docId }, // Filter by _id
              updatedDocWithoutId // Replace the entire document, excluding the _id field
            );

            // Check if the document was updated
            if (result.modifiedCount > 0) {
              panel.webview.postMessage({
                command: "success",
                message: "Document updated successfully",
              });

              // Refresh the document list after update
              const updatedDocuments = await collection
                .find()
                .limit(10)
                .toArray();
              panel.webview.postMessage({
                command: "documents",
                data: updatedDocuments,
              });
            } else {
              console.log("No changes made to the document");
              panel.webview.postMessage({
                command: "error",
                message: "No changes were made to the document",
              });
            }
          } catch (error) {
            console.error("Error occurred during the update:", error);
            panel.webview.postMessage({
              command: "error",
              message: `Error occurred: ${error}`,
            });
          }
        } catch (error) {
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
          client = new MongoClient(uri);
          await client.connect();
          db = client.db();
          panel.webview.postMessage({
            command: "success",
            message: "Connected to MongoDB",
          });

          // Fetch collections after connecting
          const collections = await db.listCollections().toArray();
          panel.webview.postMessage({
            command: "collections",
            data: collections.map((col) => col.name),
          });
        } catch (error) {
          panel.webview.postMessage({
            command: "error",
            message: `Failed to connect to MongoDB: ${error}`,
          });
        }
      }
    },
    undefined,
    context.subscriptions
  );
}
