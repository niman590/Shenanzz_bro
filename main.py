from pathlib import Path
from uuid import uuid4
from datetime import datetime
import json
import xml.etree.ElementTree as ET

import requests
import uvicorn
from fastapi import FastAPI, Form, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles


BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
LIVE_INFO_PATH = BASE_DIR / "live_info.json"

app = FastAPI(title="SNCRICK.COM")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

ADMIN_USERNAME = "SNbrothers"
ADMIN_PASSWORD = "SNbrothers"

admin_ws = None
user_sockets = {}


def load_config():
    default_config = {"NEWSAPI_KEY": "PASTE_YOUR_NEWSAPI_KEY_HERE"}
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(default_config, indent=4), encoding="utf-8")
        return default_config
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return {"NEWSAPI_KEY": data.get("NEWSAPI_KEY", "")}
    except Exception:
        return default_config


def load_live_info():
    default_info = {
        "title": "Today Live Cricket Stream",
        "description": "Admin will update this section with match details before going live.",
        "status": "Waiting for admin live stream"
    }
    if not LIVE_INFO_PATH.exists():
        LIVE_INFO_PATH.write_text(json.dumps(default_info, indent=4), encoding="utf-8")
        return default_info
    try:
        data = json.loads(LIVE_INFO_PATH.read_text(encoding="utf-8"))
        return {
            "title": data.get("title", default_info["title"]),
            "description": data.get("description", default_info["description"]),
            "status": data.get("status", default_info["status"])
        }
    except Exception:
        return default_info


def save_live_info(title, description, status):
    data = {"title": title, "description": description, "status": status}
    LIVE_INFO_PATH.write_text(json.dumps(data, indent=4), encoding="utf-8")
    return data


def demo_news():
    return [
        {
            "id": 1,
            "category": "T20 World Cup",
            "title": "ICC Men's T20 World Cup 2026 comes to India and Sri Lanka",
            "date": "Demo",
            "comments": 12,
            "image": "/static/images/cover-photo.jpeg",
            "summary": "SN CRICK brings cricket news, live updates and live streams in one place.",
            "full": "This is demo content. Your NewsAPI key is already added. If real news cannot load, demo news will appear.",
            "source": "SN CRICK",
            "url": ""
        },
        {
            "id": 2,
            "category": "Sri Lanka",
            "title": "Sri Lanka prepare for white-ball cricket",
            "date": "Demo",
            "comments": 18,
            "image": "/static/images/news2.svg",
            "summary": "The frontend and backend are connected and ready for automatic updates.",
            "full": "This demo article appears if NewsAPI returns no result or an API notice.",
            "source": "SN CRICK",
            "url": ""
        },
        {
            "id": 3,
            "category": "Live Scores",
            "title": "Free RSS live score section added",
            "date": "Demo",
            "comments": 7,
            "image": "/static/images/news3.svg",
            "summary": "Live scores use free ESPN Cricinfo RSS feed updates.",
            "full": "The score cards are loaded from ESPN Cricinfo RSS feed where available.",
            "source": "SN CRICK",
            "url": ""
        },
        {
            "id": 4,
            "category": "Streaming",
            "title": "Live stream is now at the top",
            "date": "Demo",
            "comments": 9,
            "image": "/static/images/news4.svg",
            "summary": "Users see the live stream section first when they open the website.",
            "full": "Admin can update what the live is about from the admin panel.",
            "source": "SN CRICK",
            "url": ""
        },
        {
            "id": 5,
            "category": "World Cricket",
            "title": "White and blue SN CRICK website design",
            "date": "Demo",
            "comments": 14,
            "image": "/static/images/news5.svg",
            "summary": "The dark background has been changed to a clean white website theme.",
            "full": "All major frontend buttons are connected to actions.",
            "source": "SN CRICK",
            "url": ""
        },
        {
            "id": 6,
            "category": "Admin",
            "title": "Admin live title and description added",
            "date": "Demo",
            "comments": 4,
            "image": "/static/images/news6.svg",
            "summary": "Admin can update the live stream title and description.",
            "full": "Use username SNbrothers and password SNbrothers to access the admin panel directly.",
            "source": "SN CRICK",
            "url": ""
        }
    ]


@app.get("/", response_class=HTMLResponse)
async def home():
    return FileResponse(str(BASE_DIR / "templates" / "index.html"))


@app.get("/admin-login", response_class=HTMLResponse)
async def admin_login_page():
    html = (BASE_DIR / "templates" / "admin-login.html").read_text(encoding="utf-8")
    return HTMLResponse(html.replace("{{ERROR_MESSAGE}}", ""))


@app.post("/admin-login", response_class=HTMLResponse)
async def admin_login(username: str = Form(...), password: str = Form(...)):
    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        response = RedirectResponse(url="/admin", status_code=303)
        response.set_cookie(key="sncrick_admin", value="logged_in", httponly=True)
        return response

    html = (BASE_DIR / "templates" / "admin-login.html").read_text(encoding="utf-8")
    html = html.replace("{{ERROR_MESSAGE}}", '<div class="form-error">Wrong username or password</div>')
    return HTMLResponse(html)


@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    if request.cookies.get("sncrick_admin") != "logged_in":
        return RedirectResponse(url="/admin-login", status_code=303)
    return FileResponse(str(BASE_DIR / "templates" / "admin.html"))


@app.get("/logout")
async def logout():
    response = RedirectResponse(url="/admin-login", status_code=303)
    response.delete_cookie("sncrick_admin")
    return response


@app.get("/api/live-info")
def get_live_info():
    return JSONResponse(load_live_info())


@app.post("/api/live-info")
def update_live_info(title: str = Form(...), description: str = Form(...), status: str = Form(...)):
    data = save_live_info(title, description, status)
    return JSONResponse({"ok": True, "data": data})


@app.get("/api/news")
def get_news():
    config = load_config()
    api_key = config.get("NEWSAPI_KEY", "").strip()

    if not api_key or api_key == "PASTE_YOUR_NEWSAPI_KEY_HERE":
        return JSONResponse(demo_news())

    try:
        params = {
            "q": "(cricket OR IPL OR T20 OR ODI OR Test cricket OR Sri Lanka cricket)",
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": 12,
            "apiKey": api_key
        }

        response = requests.get("https://newsapi.org/v2/everything", params=params, timeout=12)
        data = response.json()

        if data.get("status") == "error":
            return JSONResponse(demo_news())

        articles = data.get("articles", [])
        if not articles:
            return JSONResponse(demo_news())

        fallback_images = [
            "/static/images/cover-photo.jpeg", "/static/images/news2.svg", "/static/images/news3.svg",
            "/static/images/news4.svg", "/static/images/news5.svg", "/static/images/news6.svg"
        ]

        news = []
        for index, article in enumerate(articles):
            title = article.get("title") or "Cricket news update"
            description = article.get("description") or "Latest cricket update from SN CRICK."
            content = article.get("content") or description
            source = (article.get("source") or {}).get("name") or "NewsAPI"
            published_at = article.get("publishedAt") or ""

            try:
                date_text = datetime.fromisoformat(published_at.replace("Z", "+00:00")).strftime("%b %d, %Y")
            except Exception:
                date_text = "Latest"

            news.append({
                "id": index + 1,
                "category": "Cricket News",
                "title": title,
                "date": date_text,
                "comments": 0,
                "image": article.get("urlToImage") or fallback_images[index % len(fallback_images)],
                "summary": description,
                "full": content,
                "source": source,
                "url": article.get("url") or ""
            })

        return JSONResponse(news)

    except Exception:
        return JSONResponse(demo_news())


@app.get("/api/scores")
def get_scores():
    rss_url = "https://www.espncricinfo.com/ci/engine/match/index.rss?view=live"

    try:
        response = requests.get(
            rss_url,
            timeout=12,
            headers={"User-Agent": "Mozilla/5.0 SNCRICK.COM/1.0"}
        )
        response.raise_for_status()

        root = ET.fromstring(response.content)
        items = root.findall(".//item")

        scores = []
        for item in items[:10]:
            title = item.findtext("title") or "Live cricket update"
            link = item.findtext("link") or ""
            description = item.findtext("description") or "Live update from ESPN Cricinfo RSS."

            scores.append({
                "match": title,
                "status": "Live / Recent",
                "score": description,
                "note": link
            })

        if not scores:
            scores = [{
                "match": "No live matches found",
                "status": "RSS Connected",
                "score": "No score items available right now",
                "note": "Check later"
            }]

        return JSONResponse(scores)

    except Exception as error:
        return JSONResponse([
            {"match": "Sri Lanka vs West Indies", "status": "Demo Live", "score": "SL 142/4 (16.2)", "note": "Free ESPN RSS could not load: " + str(error)},
            {"match": "India vs Pakistan", "status": "Upcoming", "score": "Today 7:30 PM", "note": "Demo score card"},
            {"match": "RCB vs CSK", "status": "Result", "score": "RCB won by 7 wickets", "note": "Demo result card"}
        ])


@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    global admin_ws

    await websocket.accept()
    role = None
    user_id = None

    try:
        register = await websocket.receive_json()
        role = register.get("role")

        if role == "admin":
            admin_ws = websocket
            await websocket.send_json({"type": "admin-ready"})

            for existing_user_id in list(user_sockets.keys()):
                await websocket.send_json({"type": "user-joined", "userId": existing_user_id})

            while True:
                msg = await websocket.receive_json()
                target = msg.get("target")

                if target and target in user_sockets:
                    await user_sockets[target].send_json(msg)
                elif msg.get("type") == "admin-live":
                    for uid, user_socket in list(user_sockets.items()):
                        try:
                            await user_socket.send_json({"type": "admin-live"})
                        except Exception:
                            user_sockets.pop(uid, None)

        else:
            user_id = str(uuid4())
            user_sockets[user_id] = websocket

            await websocket.send_json({"type": "user-id", "userId": user_id})

            if admin_ws:
                await admin_ws.send_json({"type": "user-joined", "userId": user_id})

            while True:
                msg = await websocket.receive_json()
                msg["userId"] = user_id

                if admin_ws:
                    await admin_ws.send_json(msg)
                else:
                    await websocket.send_json({"type": "admin-offline"})

    except WebSocketDisconnect:
        if role == "admin":
            admin_ws = None
            for uid, user_socket in list(user_sockets.items()):
                try:
                    await user_socket.send_json({"type": "admin-offline"})
                except Exception:
                    user_sockets.pop(uid, None)

        if user_id and user_id in user_sockets:
            user_sockets.pop(user_id, None)
            if admin_ws:
                try:
                    await admin_ws.send_json({"type": "user-left", "userId": user_id})
                except Exception:
                    pass


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)


#niman nethmika