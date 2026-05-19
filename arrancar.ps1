# arrancar.ps1 - lanza el servidor Rummikub:
#   * Juego en :8443 HTTPS (publicar al router)
#   * Panel de control en :8080 HTTP (NO publicar, solo LAN)
# Si ya hay algo en cualquiera de los dos puertos lo mata primero.

$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

function Matar-Puerto($puerto) {
    $linea = netstat -ano | Select-String ":$puerto " | Select-String 'LISTENING' | Select-Object -First 1
    if ($linea) {
        $procId = ($linea -split '\s+')[-1]
        Write-Host "Parando instancia previa en :$puerto (PID $procId)..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

Matar-Puerto 8443
Matar-Puerto 8080

Set-Location C:\rummikub-online

# Lanzar el panel de admin en segundo plano (puerto 8080, solo LAN, HTTP)
$pyExe = "C:\Users\sintr\AppData\Local\Programs\Python\Python312\python.exe"
$adminCmd = "`"$pyExe`" -m uvicorn backend.main:admin_app --host 0.0.0.0 --port 8080 > C:\rummikub-online\admin.log 2>&1"
$result = ([WMICLASS]"\\.\Root\CIMV2:Win32_Process").Create("cmd.exe /c $adminCmd", "C:\rummikub-online", $null)
Write-Host "Panel de control lanzado en :8080 (PID $($result.ProcessId))"

Write-Host ""
Write-Host "URL para jugar:        https://<IP-publica>:8443 (acepta el aviso de seguridad la primera vez)"
Write-Host "Panel de control:      http://<IP-LAN>:8080  (sin login, no abrir al router)"
Write-Host "Para parar: cierra esta ventana o Ctrl+C"
Write-Host ""

# Lanzar el servidor del juego en primer plano (puerto 8443 HTTPS)
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8443 `
    --ssl-keyfile C:\rummikub-online\certs\key.pem `
    --ssl-certfile C:\rummikub-online\certs\cert.pem
