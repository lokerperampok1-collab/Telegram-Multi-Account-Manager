import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse

from config import settings
from database.db import init_db
from services.client_manager import client_manager
from routes import auth, accounts, telegram

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    await client_manager.initialize()
    print(">> Database initialized and ClientManager ready.")
    yield
    # Shutdown
    print(">> Shutting down, disconnecting active clients...")
    await client_manager.disconnect_all()
    print(">> Clean shutdown completed.")

app = FastAPI(
    title="Telegram Account Manager",
    description="Multi-account Telegram userbot & account repository with QR Code and Phone login support",
    version="1.0.0",
    lifespan=lifespan
)

# Ensure directories exist
os.makedirs("static/css", exist_ok=True)
os.makedirs("static/js", exist_ok=True)
os.makedirs("static/images", exist_ok=True)
os.makedirs("templates", exist_ok=True)
os.makedirs("sessions", exist_ok=True)

# Mount static files & templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Register API routers
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(accounts.router, prefix="/api/accounts", tags=["Accounts"])
app.include_router(telegram.router, prefix="/api/telegram", tags=["Telegram"])

# Frontend web views
@app.get("/", response_class=HTMLResponse)
async def home_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"api_configured": bool(settings.API_ID and settings.API_HASH)}
    )

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(request=request, name="login.html")

@app.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    return templates.TemplateResponse(request=request, name="register.html")

@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "telegram_credentials_configured": bool(settings.API_ID and settings.API_HASH)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
