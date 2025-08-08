"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWebviewContent = void 0;
function getWebviewContent() {
    return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MongoDB Viewer</title>
    <style>
      body {
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background-color: #1e1e1e;
        color: #d1d5db;
        padding: 20px;
      }
      h2 {
        color: #10b981;
        margin-bottom: 20px;
      }
      /* Navbar container */
      .navbar {
        overflow-y: scroll;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #1e1e1e;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
      }

      /* Buttons */
      .button {
        background: #10b981;
        color: white;
        border: none;
        padding: 10px 15px;
        margin-right: 10px;
        font-size: 16px;
        cursor: pointer;
        border-radius: 5px;
        transition: background 0.3s ease, transform 0.2s;
      }

      .button:hover {
        background: #0e9b74;
        transform: scale(1.05);
      }

      /* Collections list */
      .collections-list {
        display: flex;
        list-style: none;
        padding: 0;
        margin: 0;
        gap: 10px;
      }

      .collections-list li {
        background: #2a2a2a;
        color: white;
        padding: 8px 12px;
        border-radius: 5px;
        transition: background 0.3s;
      }

      .collections-list li:hover {
        background: #333;
        cursor: pointer;
      }

      .collections-container {
        display: flex;
        flex-wrap: wrap;
        gap: 15px;
        margin-top: 20px;
      }
      .collection-card {
        background: #2d2d2d;
        padding: 15px;
        border-radius: 8px;
        cursor: pointer;
        width: 180px;
        text-align: center;
        transition: 0.3s;
        border: 1px solid #333;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }
      .collection-card:hover {
        background: #3b3b3b;
        border-color: #10b981;
        transform: translateY(-5px);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
      }
      td {
        border: 1px solid #3b3b3b;
        padding: 12px;
        text-align: left;
        max-width: 300px; /* Adjust width as needed */
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      td[data-fulltext]:hover::after {
        content: attr(data-fulltext);
        position: absolute;
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        padding: 5px;
        border-radius: 5px;
        white-space: normal;
        max-width: 400px;
        z-index: 10;
      }

      th {
        background: #2a2a2a;
        color: #10b981;
        font-weight: bold;
      }

      tr:nth-child(even) {
        background: #242424;
      }

      tr:hover {
        background-color: #333;
        cursor: pointer;
      }

      #modal {
        display: none;
        position: fixed;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
  
        background: rgba(0, 0, 0, 0.7);
        justify-content: center;
        align-items: center;
      }
      #modalContent {
        background: #2a2a2a;
        padding: 25px;
        border-radius: 10px;
        width: 550px;
        height: 80vh;
        overflow:scroll;
        color: white;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
      }
      #closeModal {
        float: right;
        cursor: pointer;
        color: red;
        font-weight: bold;
        font-size: 20px;
      }
      .modal-input {
        width: 100%;
        padding: 10px;
        margin: 10px 0;
        border-radius: 5px;
        background: #333;
        color: white;
        border: 1px solid #444;
        font-size: 14px;
      }
      .edit-button {
        background-color: #facc15;
        color: black;
        border: none;
        cursor: pointer;
        padding: 8px 12px;
        border-radius: 5px;
        font-size: 14px;
        transition: 0.3s;
      }
      .edit-button:hover {
        background-color: #e6b800;
      }
      .save-button {
        background-color: #10b981;
        color: white;
        border: none;
        cursor: pointer;
        padding: 10px 20px;
        margin-top: 15px;
        border-radius: 5px;
        font-size: 14px;
        transition: 0.3s;
      }
      .save-button:hover {
        background-color: #0ea374;
      }
      .nav-left {
        display: flex;
      }

      /* Pagination Styling */
      .pagination {
        display: flex;
        justify-content: center;
        margin-top: 20px;
      }

      .page-button {
        background: #333;
        color: white;
        border: none;
        padding: 8px 12px;
        margin: 0 5px;
        border-radius: 5px;
        cursor: pointer;
        transition: background 0.3s;
      }

      .page-button:hover {
        background: #555;
      }

      .page-button:disabled {
        background: #555;
        cursor: not-allowed;
      }

      /* Search Styling */
      .search-container {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 10px;
      }

      .search-input {
        padding: 8px;
        border-radius: 5px;
        border: 1px solid #555;
        background: #333;
        color: white;
        margin-right: 10px;
      }
    </style>
  </head>
  <body>
    
    <div id="uriForm">
 <h3>Connect to <span style="color:#00593F">MongoDB</span></h3>
      <input
        type="text"
        id="mongoUriInput"
        value="mongodb://localhost:27017/db"
        placeholder="Enter MongoDB URI"
        class="modal-input"
      />
      <button id="connectButton" class="button">Connect</button>
      <button id="refreshButton" class="button" style="display: none;float:right;">
        Refresh
      </button>
      <button id="fetchCollections" class="button" style="display: none">Fetch Collections</button>
    </div>

    <nav class="navbar">
      <ul id="collectionsList" class="collections-list"></ul>
    </nav>

   <div class="search-container">
  <input
    type="text"
    id="searchInput"
    class="search-input"
    placeholder="Search documents..."
  />
  <span id="searchLoading" style="display: none; color: #10b981; margin-left: 10px;">Loading...</span>
</div>

    <h2>Documents</h2>
    <table id="documentsTable">
      <thead>
        <tr id="tableHead"></tr>
      </thead>
      <tbody id="tableBody"></tbody>
    </table>

    <!-- Pagination -->
    <div class="pagination">
      <button id="prevPage" class="page-button" disabled>Previous</button>
      <span id="pageInfo">Page 1 of 1</span>
      <button id="nextPage" class="page-button" disabled>Next</button>
    </div>

    <!-- Modal for editing document -->
    <div id="modal">
      <div id="modalContent">
        <span id="closeModal">&times;</span>
        <h3>Edit Document</h3>
        <form id="editForm">
          <div id="modalInputs"></div>
          <button type="button" id="saveButton" class="save-button">
            Save
          </button>
        </form>
      </div>
    </div>

    <script>
      document.getElementById("connectButton").addEventListener("click", () => {
        const uri = document.getElementById("mongoUriInput").value;
        if (uri) {
          vscode.postMessage({ command: "connectMongoDB", uri: uri });
        } else {
          alert("MongoDB URI is required");
        }
      });
      document.addEventListener("DOMContentLoaded", function () {
        document.querySelectorAll("td").forEach((td) => {
          const text = td.textContent.trim();
          if (text.length > 100) {
            td.setAttribute("data-fulltext", text);
            td.textContent = text.substring(0, 100) + "...";
          }
        });
      });

      const vscode = acquireVsCodeApi();
      let editingDocId = null;
      let currentDocument = null;
      let currentPage = 1;
      let totalPages = 1;
      let currentSearchTerm = "";
      let currentCollection = null;

      document
        .getElementById("fetchCollections")
        .addEventListener("click", () => {
          vscode.postMessage({ command: "fetchCollections" });
        });

      document.getElementById("refreshButton").addEventListener("click", () => {
        const collection = document.querySelector("li.selected");
        if (collection) {
          fetchDocuments(collection.textContent, 1, currentSearchTerm);
        }
      });

      // Search Functionality
    document.getElementById("searchInput").addEventListener("input", (e) => {
  const searchLoading = document.getElementById("searchLoading");
  searchLoading.style.display = "inline-block"; // Show loading indicator
  currentSearchTerm = e.target.value;

  // Debounce the search to avoid excessive requests
  clearTimeout(window.searchTimeout);
  window.searchTimeout = setTimeout(() => {
    fetchDocuments(currentCollection, 1, currentSearchTerm);
    searchLoading.style.display = "none"; // Hide loading indicator
  }, 300); // 300ms debounce delay
});

      // Pagination functions
      document.getElementById("prevPage").addEventListener("click", () => {
        if (currentPage > 1) {
          fetchDocuments(currentCollection, currentPage - 1, currentSearchTerm);
        }
      });

      document.getElementById("nextPage").addEventListener("click", () => {
        if (currentPage < totalPages) {
          fetchDocuments(currentCollection, currentPage + 1, currentSearchTerm);
        }
      });

      // Function to fetch documents with pagination and search
      function fetchDocuments(collection, page, searchTerm) {
        currentCollection = collection;
        currentPage = page;
        currentSearchTerm = searchTerm;
        vscode.postMessage({
          command: "fetchDocuments",
          collection: collection,
          page: page,
          searchTerm: searchTerm,
        });
      }

      window.addEventListener("message", (event) => {
        const message = event.data;

        if (message.command === "documents") {
          const tableHead = document.getElementById("tableHead");
          const tableBody = document.getElementById("tableBody");
          tableHead.innerHTML = "";
          tableBody.innerHTML = "";

          if (message.data.length === 0) {
            tableHead.innerHTML = "<th>No Documents Found</th>";
            return;
          }

          // Create table headers
          const keys = Object.keys(message.data[0]);
          keys.forEach((key) => {
            const th = document.createElement("th");
            th.textContent = key;
            tableHead.appendChild(th);
          });
          const th = document.createElement("th");
          // th.textContent = "Actions";
          tableHead.appendChild(th);

          // Populate table rows
          message.data.forEach((doc) => {
            const tr = document.createElement("tr");
            keys.forEach((key) => {
              const td = document.createElement("td");
              td.textContent =
                typeof doc[key] === "object"
                  ? JSON.stringify(doc[key])
                  : doc[key];
              tr.appendChild(td);
            });

            // Add Edit Button
            // const editButtonTd = document.createElement("td");
            // const editButton = document.createElement("button");
            // editButton.textContent = "Edit";
            // editButton.classList.add("edit-button");
            // editButton.addEventListener("click", () => {
            //   currentDocument = doc;
            //   editingDocId = doc._id;
            //   const modalInputs = document.getElementById("modalInputs");
            //   modalInputs.innerHTML = "";
            //   keys.forEach((key) => {
            //     const label = document.createElement("label");
            //     label.textContent = key;
            //     label.style.display = "block";
            //     const input = document.createElement("input");
            //     input.type = "text";
            //     input.value = doc[key];
            //     input.classList.add("modal-input");
            //     input.dataset.key = key;
            //     modalInputs.appendChild(label);
            //     modalInputs.appendChild(input);
            //   });

            //   document.getElementById("modal").style.display = "flex";
            // });
            // editButtonTd.appendChild(editButton);
            // tr.appendChild(editButtonTd);

            tableBody.appendChild(tr);
          });

          // Update pagination information
          currentPage = message.page;
          totalPages = message.totalPages;
          document.getElementById("pageInfo").textContent = \`Page \${currentPage} of \${totalPages}\`;
          document.getElementById("prevPage").disabled = currentPage === 1;
          document.getElementById("nextPage").disabled = currentPage === totalPages;
        }

        if (message.command === "collections") {
          const collectionsList = document.getElementById("collectionsList");
          collectionsList.innerHTML = "";
          message.data.forEach((collectionName) => {
            const li = document.createElement("li");
            li.textContent = collectionName;
            li.addEventListener("click", () => {
              // Remove 'selected' class from all li elements
              document
                .querySelectorAll("#collectionsList li")
                .forEach((item) => item.classList.remove("selected"));

              // Add 'selected' class to the clicked li element
              li.classList.add("selected");
              fetchDocuments(collectionName, 1, currentSearchTerm);
              currentCollection = collectionName;
            });
            collectionsList.appendChild(li);
          });
          document.getElementById("fetchCollections").style.display = "none";
          document.getElementById("refreshButton").style.display = "block";
        }

        if (message.command === "error") {
          alert("Error: " + message.message);
        }

        if (message.command === "success") {
          document.getElementById("fetchCollections").style.display = "block";
          alert(message.message);
        }
      });

      // Modal interactions
      document.getElementById("closeModal").addEventListener("click", () => {
        document.getElementById("modal").style.display = "none";
      });

      document.getElementById("saveButton").addEventListener("click", () => {
        const updatedDoc = {};
        document.querySelectorAll(".modal-input").forEach((input) => {
          updatedDoc[input.dataset.key] = input.value;
        });

        vscode.postMessage({
          command: "updateDocument",
          docId: editingDocId,
          updatedDoc: updatedDoc,
        });

        document.getElementById("modal").style.display = "none";
      });
    </script>
  </body>
</html>
`;
}
exports.getWebviewContent = getWebviewContent;
//# sourceMappingURL=webviewPanel.js.map