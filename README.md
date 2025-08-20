# Lean 4 Copilot

Lean 4 Copilot is a powerful AI assistant for the Lean 4 theorem prover, integrated directly into Visual Studio Code. It combines the generative capabilities of Large Language Models (LLMs) with the strictness of the Lean 4 compiler, ensuring that every AI-generated suggestion is formally verified before it's presented to you.

This tool is designed to lower the barrier for newcomers and enhance productivity for experienced users by automating proof steps, completing theorems, and offering intelligent recovery from errors.

---

## ✨ Features

The extension provides three core, seamlessly integrated workflows:

- **👻 Ghost-Text Suggestions**: Get automatic, single-line suggestions for your next proof step displayed directly in the editor as you type.
- **🤖 Full Proof Completion**: When you're stuck on a larger proof, invoke the "Complete Proof" command. The assistant will generate a complete, multi-line proof, which you can review in a diff view before accepting. 
- **🔄 Interactive Retry with Hints**: If a proof completion fails verification, an error panel appears with the model's attempt and the Lean compiler's error log. You can then trigger a retry, optionally providing a natural language hint to guide the LLM towards a better solution. 
- **✅ Verification-First Approach**: The cornerstone of Lean 4 Copilot is its reliability. **No code is suggested to you until it has been successfully validated by the local Lean 4 compiler.** This prevents invalid or syntactically incorrect suggestions, building trust and saving you time.

---

## 🏗️ Architecture

The system uses a modular, client–server architecture to balance powerful AI processing with local validation speed:

- **Frontend (VS Code Extension)**: A TypeScript-based extension that provides the user interface, captures the document context, and communicates with the backend. 
- **Backend (Python Server)**: A FastAPI server that constructs prompts, queries the OpenAI API using LangChain, and, most importantly, invokes a local Lean 4 process to verify the LLM's output.

This design was chosen to leverage powerful remote LLMs without requiring users to host models locally, while ensuring verification remains fast and consistent with the user's own Lean environment.

---

## 🛠️ Setup and Installation

Follow these steps to set up the Lean 4 Copilot for local development.

### Prerequisites

Make sure you have the following installed:

- **Lean 4**: The Lean command-line tool (`lean`) must be installed and available in your system's PATH.
- **Python 3.11+** 
- **Node.js and npm**
- **An OpenAI API Key**

### 1. Backend Setup

The backend server handles LLM communication and Lean verification.

```bash
# 1. Navigate to the backend directory
cd backend

# 2. Create and activate a Python virtual environment
python -m venv venv
source venv/bin/activate  # On Windows, use `venv\Scripts\activate`

# 3. Install dependencies
pip install "fastapi==0.110.2" "uvicorn[standard]" "langchain==0.3.27" "langchain-openai==0.3.28" "pydantic==2.11.7" "python-dotenv==1.1.0"

# 4. Create a .env file for your API key
touch .env

# 5. Add your OpenAI API key to the .env file
echo 'OPENAI_API_KEY="sk-..."' > .env
```

You can also set the `LEAN_CMD` environment variable in the `.env` file if your Lean executable is not in the default PATH.

---

## 2. Frontend (VS Code Extension) Setup

The frontend is the VS Code extension that you interact with.

```bash
# 1. From the project's root directory, install npm dependencies
npm install

# 2. Compile the TypeScript code
npm run compile
```

## 🚀 Running for Development

To run the full system, you need to start both the backend server and the VS Code extension.

### Start the Backend Server

In your terminal, from the `backend` directory, run:

```bash
uvicorn app.main:app --reload --port 8000
```

The server will be available at `http://localhost:8000`.

---

## Launch the VS Code Extension

- Open the root project folder in VS Code.  
- Press `F5` to open a new **Extension Development Host** window.  
- This new window will have the Lean 4 Copilot extension activated and connected to your local backend server.

---

## 🧪 Testing

The project includes unit tests for both the frontend and backend.

### Backend Tests

```bash
# From the 'backend' directory
pytest
```

### Frontend Tests

```bash
# From the project lean4-copilot directory
npm test
```