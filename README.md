# AI Inventory Management Agent

An AI-powered, chat-based inventory management system that allows users to manage products and stock using natural language. It uses **Google Gemini AI** and a custom **Model Context Protocol (MCP) server** to understand user requests and perform inventory operations.

## 🚀 Features

- **Natural Language Chat:** Manage inventory by asking questions in simple English.
- **Product Search:** Search products by product name, SKU, or category.
- **Stock Monitoring:** Identify low-stock and out-of-stock products.
- **Stock Updates:** Update inventory quantities using SKU.
- **Add New Products:** Add products with variants, prices, and initial stock.
- **AI Integration:** Google Gemini understands user requests and selects the appropriate tool.
- **MCP Integration:** A custom MCP server exposes inventory operations as tools.
- **SQLite Database:** Stores product, variant, category, and inventory information.

## 🛠️ Tech Stack

**Frontend**
- React
- TypeScript
- Vite

**Backend**
- Node.js
- Express.js
- TypeScript

**AI & Communication**
- Google Gemini API
- Model Context Protocol (MCP)
- MCP TypeScript SDK
- Streamable HTTP

**Database**
- SQLite
- better-sqlite3

## 🏗️ System Architecture

```text
User
  |
  v
React + TypeScript Frontend
  |
  v
Express.js Backend
  |
  v
Google Gemini AI
  |
  v
MCP Client
  |
  v
Custom MCP Server
  |
  v
Inventory Tools
  |
  v
SQLite Database
```

## ⚙️ How It Works

1. The user enters an inventory-related query in the chat interface.
2. The frontend sends the query to the Express backend.
3. Google Gemini understands the user's intent and selects the appropriate tool.
4. The backend MCP client invokes the selected tool on the custom MCP server.
5. The MCP server executes the inventory operation using SQLite.
6. The result is sent back to Gemini.
7. Gemini generates a natural-language response displayed in the chat interface.

## 🔧 MCP Tools

| Tool | Description |
|---|---|
| `search_products` | Search products by name, SKU, or category |
| `get_stock_status` | Retrieve available, low-stock, and out-of-stock products |
| `update_stock` | Update product stock using SKU |
| `add_product` | Add a new product with variants and initial stock |

## 🗄️ Database Schema

The application uses four SQLite tables:

- **Categories:** Stores product categories.
- **Products:** Stores product details.
- **ProductVariants:** Stores product variants, unique SKUs, and prices.
- **Inventory:** Stores stock quantities and reorder levels.

## 💬 Example Queries

Try asking the AI agent:

- "Search for laptop products."
- "Find product with SKU LAP-001."
- "Show me all low-stock products."
- "Which products are out of stock?"
- "Update stock of LAP-001 to 25."
- "Add a new wireless mouse with SKU MOU-102 and quantity 50."

## 📁 Project Structure

```text
AI-Inventory-Management-Agent/
│
├── backend/
│   └── src/
│       ├── db.ts
│       ├── seed.ts
│       ├── inventory.ts
│       ├── mcp-server.ts
│       ├── ai.ts
│       └── index.ts
│
├── frontend/
│   └── src/
│
├── .env.example
├── .gitignore
└── README.md
```

## 🔑 Environment Variables

Create a `.env` file in the project root and add your Gemini API key:

```env
GEMINI_API_KEY=your_gemini_api_key
```

Never commit your actual API key to GitHub.

## ▶️ Installation & Setup

### 1. Clone the repository

```bash
git clone https://github.com/SandhyaDhakad123/AI-Inventory-Management-Agent.git
cd AI-Inventory-Management-Agent
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Start the MCP server

Open a terminal in the backend directory:

```bash
npm run mcp
```

### 4. Start the backend API

Open another terminal:

```bash
cd backend
npm run api
```

### 5. Install frontend dependencies

Open a third terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL displayed by Vite in your browser.

## 🔮 Future Improvements

- User authentication and role-based access.
- Inventory analytics and dashboard.
- Automated stock alerts.
- Supplier and purchase order management.
- Cloud database integration.

## 👩‍💻 Author

**Sandhya Dhakad**

B.Tech – Computer Science and Engineering (AI & ML)

GitHub: [SandhyaDhakad123](https://github.com/SandhyaDhakad123)

---

⭐ If you find this project useful, consider giving it a star!
