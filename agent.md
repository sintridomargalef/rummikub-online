# Rummikub Online — Notas para el agente

> Documento para que cualquier futura sesión del agente entienda el contexto del proyecto, su estado actual, las particularidades del despliegue y las convenciones que ya hemos acordado. Léelo entero antes de tocar nada.

---

## 1. Qué es este proyecto

App web multi-jugador para jugar al Rummikub por internet entre el usuario (Manel) y María (su pareja), con extensiones para invitar a otras parejas del torneo presencial (Jordi/María, Àngel/Raquel, Judith/Toni, Oscar/Diana, Manel/Carmina).

- **Stack:** Python 3.12 + FastAPI + WebSockets en el backend; HTML/CSS/JS vanilla en el frontend (sin frameworks).
- **Repositorio GitHub:** https://github.com/sintridomargalef/rummikub-online
- **Path local del usuario:** `C:\Python\RummyKubOnline\`
- **Worktree de trabajo del agente:** se trabaja desde `C:\Python\SPeak\.claude\worktrees\amazing-greider-875cfb` apuntando a `C:\Python\RummyKubOnline\` (los paths son absolutos).

## 2. Despliegue de producción

El servidor de producción se llama **PT JORDI**, IP local **192.168.1.35** (puede cambiar; en su día fue 192.168.1.40). Es una máquina Windows 10/11 en su red doméstica.

- **Puerto del juego:** `8443` **HTTPS** (certificado autofirmado en `C:\rummikub-online\certs\{key,cert}.pem`).
- **Puerto del panel admin:** `8080` HTTP (solo LAN, NO se redirige en el router).
- **Router:** redirige el puerto externo `8443 → 192.168.1.35:8443`. NO se redirige el 8080.
- **Acceso al router:** lo controla el usuario (192.168.1.1).
- **IP pública:** fija de operador. El usuario me la dará cuando haga falta.
- **Acceso SSH:** activo en `sintr@192.168.1.35:22`, autenticación por **mi clave pública** `claude-code@PCSINTRIDO` que vive en `C:\ProgramData\ssh\administrators_authorized_keys`.
- **Acceso interactivo del usuario:** vía **RustDesk** al escritorio de PT JORDI.

### Cómo arranca/para el servidor

El usuario tiene una app Tkinter propia: **Rummikub Control** (`rummikub_control.py`) que pinta dos secciones (GAME SERVER :8443 y ADMIN SERVER :8080) con botones INICIAR/DETENER y muestra los logs en directo. Es el lanzador "oficial". No lanza uvicorn por SSH directamente.

**Importante:**
- Tras un deploy de código, **NO arrancar uvicorn yo desde SSH**. Pedir al usuario que pulse DETENER → INICIAR en su panel (o reiniciar el panel completo si el cambio afecta a `rummikub_control.py`).
- El panel se puede reiniciar yo desde SSH usando `schtasks /Create /SC ONCE /IT /TR pythonw.exe ...` (ver §6 "Lanzar GUI en sesión interactiva").

### `arrancar.ps1`

También existe `C:\rummikub-online\arrancar.ps1` (un script alternativo de arranque manual). Pero el flujo habitual es el panel Tkinter, no este script.

## 3. Estructura del código

```
C:\Python\RummyKubOnline\
├── backend\
│   ├── main.py            # FastAPI: dos apps (app + admin_app), WebSocket /ws/{codigo}
│   ├── game\
│   │   ├── tiles.py       # 106 fichas con id único
│   │   ├── board.py       # Validación grupos/escaleras, REGLAS_POR_DEFECTO
│   │   ├── state.py       # GameState con snapshot por jugador
│   │   └── rules.py       # aplicar_jugada con validación canónica
│   ├── rooms.py           # Sala efímera en memoria
│   ├── stats.py           # Ranking persistente en data/stats.json
│   └── ai_solver.py       # IA bot (UNTRACKED, local del usuario)
├── frontend\
│   ├── index.html         # Lobby
│   ├── game.html          # Mesa de juego
│   ├── admin.html         # Panel /admin
│   ├── css\style.css      # Temas: classic / cyberpunk / nature / desert
│   └── js\
│       ├── lobby.js
│       ├── game.js        # Render mesa, drag&drop, WebRTC signaling client
│       ├── ws.js          # RKSocket con auto-reconexión y wss://
│       ├── comm.js        # WebRTC P2P (video+audio) + chat
│       └── theme.js
├── certs\                 # Certs SSL autofirmados (NO commitear)
├── data\                  # stats.json (NO commitear, en .gitignore)
├── tests\test_rules.py    # 28+ tests del motor
├── render.yaml            # Despliegue Render (backup, opcional)
├── arrancar.ps1           # Lanzador manual de uvicorn
├── rummikub_control.py    # Panel Tkinter del usuario (UNTRACKED)
└── agent.md               # este fichero
```

## 4. Features ya implementadas

- Lobby con código de 4 letras, copy link `?join=CODE`.
- Mesa con atril en rejilla 2 filas × N slots, fichas con drag&drop (pointer events: ratón + táctil).
- Reglas oficiales: grupos, escaleras, jokers, salida 30 pts, victoria por atril vacío.
- Reglas opcionales: `wrap_13_to_1`, `tiempo_total`, `tiempo_turno`, `juego_extremo`, `contra_ia`.
- Auto-ordenado de escaleras al insertar ficha.
- Swap de joker (arrastrar ficha real sobre joker).
- Partir escalera al duplicar número (5-6-7-8-9-10 + 8 → 5-6-7-8 + 8-9-10).
- Undo/Redo.
- Banner "TURNO DE: X" con cronómetro de partida y cronómetro de turno (auto-pasar a 3 min).
- Sonidos (turno propio, error, victoria, aviso 30 s).
- Voz TTS opcional (es-ES).
- Chat de texto in-game + WebRTC video + audio P2P entre dos jugadores (signaling vía WS).
- Tema Cyberpunk con fixes de contraste para botón Robar/Fin Turno.
- Tema Desierto (arena, dunas).
- Click izquierdo en ficha del atril = añadir a la última combinación · click derecho = cancelar.
- Hint banner permanente cuando es tu turno.
- Ranking persistente en `data/stats.json` (per-jugador: victorias, partidas, %).
  - Endpoint público `/api/ranking`.
  - Endpoints admin `/api/admin/ranking`, `/api/admin/ranking/renombrar`, `/api/admin/ranking/reset`.
  - Modal "🏆 Ranking" en el lobby (botón al final).
- Panel admin en :8080 sin auth (solo LAN): salas activas, cerrar individual, cerrar todas. NO incluir ranking UI ahí (TODO).
- IA bot (lógica del usuario en `ai_solver.py` + `AiMemory` en `main.py`). Modo "contra IA" en reglas.

## 5. Convenciones / lecciones aprendidas con el usuario

- **No tocar sus modificaciones locales.** Cuando hay `git status --short` con M en archivos como `main.py`, `game.js`, `lobby.js`, `state.py`, etc., **NO commitear esos cambios** ni pisarlos en deploys. Hacer `git add` solo de los archivos que YO cambio.
- **Deploy seguro a PT JORDI:**
  1. `git push` desde el worktree del agente.
  2. SSH a PT JORDI: `git stash -u && git pull --rebase && git stash pop`.
  3. Si hay conflicto en archivos del usuario (typ. `game.js`): `git checkout HEAD -- <archivo>` para quedarse con mi versión, el stash original sigue disponible (`git stash list`).
  4. Pedir al usuario que reinicie el server desde su **Rummikub Control panel** (DETENER → INICIAR). Si yo necesito reiniciar el panel, ver §6.
- **Para tocar `main.py` (tiene mods del usuario):** usar `scp` desde mi copia local hacia PT JORDI, no via git. Igual para `stats.py`, `rummikub_control.py`, `arrancar.ps1` que no están comiteados o tienen versiones distintas.
- **Marcar `main.py` como "assume-unchanged"** antes de pulls si toca: `git update-index --assume-unchanged backend/main.py` (y luego `--no-assume-unchanged` para no romper más allá).
- **No usar `query` en PowerShell** (no existe). Usar `Get-CimInstance Win32_Process` para listar procesos.
- **Si `git stash pop` da conflictos**, resolver con `git checkout HEAD -- <archivos en conflicto>` y el stash sigue intacto en `git stash list`.
- **Encoding de SSH:** los warnings de PowerShell ("Cannot process the XML from the 'Error' stream") son ruido inocuo cuando llamamos `ssh ... powershell -EncodedCommand ...`. Ignorar ese ruido.

## 6. Lanzar GUI en sesión interactiva del usuario desde SSH

Windows tiene Session 0 isolation. Un proceso lanzado por SSH normalmente NO se ve en el escritorio del usuario. Para lanzar **Tkinter GUI en la sesión del usuario** (SessionId 1 típicamente):

```powershell
schtasks /Delete /TN "rk_relaunch" /F 2>&1 | Out-Null
$hora = (Get-Date).AddSeconds(15).ToString("HH:mm:ss")
schtasks /Create /TN "rk_relaunch" /SC ONCE /ST $hora `
    /TR '"C:\Users\sintr\AppData\Local\Programs\Python\Python312\pythonw.exe" "C:\rummikub-online\rummikub_control.py"' `
    /F /IT 2>&1
schtasks /Run /TN "rk_relaunch" 2>&1
Start-Sleep 10
schtasks /Delete /TN "rk_relaunch" /F 2>&1 | Out-Null
```

- `/IT` = Interactive Token = se ejecuta en la sesión interactiva del usuario (la que ve por RustDesk).
- Importante usar **ruta completa** a `pythonw.exe` para evitar PATH issues.
- `WMI Win32_Process Create` desde SSH **NO funciona** para procesos GUI: crea el proceso pero queda en Session 0, invisible.

## 7. Cosas que el agente NO debe hacer

- ❌ Lanzar uvicorn desde SSH cuando el usuario está usando su panel Rummikub Control (chocan por puerto).
- ❌ Tocar `backend/ai_solver.py`, `rummikub_control.py` u otros archivos del usuario sin avisar.
- ❌ Commitear archivos que tienen cambios locales del usuario sin coordinarlo.
- ❌ Pasar la cámara/micro/datos personales del usuario por mi servidor (WebRTC va P2P, signaling solo).
- ❌ Modificar configuración de Render: ya no se usa (Render queda como backup, pero el flujo activo es self-hosted).
- ❌ Abrir el puerto 8080 (admin) en el router. NUNCA. Solo LAN.

## 8. Estado al cerrar esta sesión

- Último commit pusheado: revisar con `git log -n 1 origin/main`.
- PT JORDI tiene HTTPS funcionando en 8443 con cert autofirmado.
- Panel Tkinter relanzado con resaltado fuerte de botones (▶ INICIADO ✓ / ■ PARADO ✓).
- Pendientes vivos (preguntar al usuario antes de seguir):
  - Añadir sección de Ranking en `admin.html` (UI + renombrar/reset).
  - Pulir lógica del "asa de combinación" que quedó incompleta semanas atrás.
  - Auto-arranque del server al boot de PT JORDI (Task Scheduler trigger AT LOGON).
  - Ranking por parejas (vista alternativa).

## 9. Credenciales y rutas útiles

- **Usuario PT JORDI:** `sintr` (admin).
- **Mi clave SSH pública:** `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN3IlqYLwqfu3TYOafgHriBOGNMG+OxzGGVz5lIU8MQA claude-code@PCSINTRIDO`
- **Python en PT JORDI:** `C:\Users\sintr\AppData\Local\Programs\Python\Python312\python.exe` (y `pythonw.exe`).
- **Repo en PT JORDI:** `C:\rummikub-online\`.
- **Logs uvicorn:** `C:\rummikub-online\server.log` (juego) y `admin.log` (admin).
- **VPN Vilamarch:** conecta a 81.0.52.36, expone solo el endpoint 192.168.5.230 (no usable para llegar a otras máquinas de esa LAN).

## 10. Cómo verificar que todo funciona después de un deploy

```powershell
# Desde el PC del agente:
curl.exe -k -s -o nul -w "Juego: %{http_code}\n" https://192.168.1.35:8443/
curl.exe -s -o nul -w "Admin: %{http_code}\n" http://192.168.1.35:8080/
curl.exe -k -s https://192.168.1.35:8443/api/ranking
```

Las tres deben devolver 200 / JSON válido. Si una falla, mirar:
- `server.log` y `admin.log` por SSH.
- `netstat -ano | findstr LISTENING | findstr "0.0.0.0:8443 0.0.0.0:8080"` para confirmar bind.
- Que el panel Rummikub Control muestre **▶ INICIADO ✓** en verde.
