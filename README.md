# Rummikub Online

App web para jugar Rummikub 1 vs 1 por internet.

## Requisitos
- Python 3.10+

## Ejecución local
```
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```
Abrir http://localhost:8000 en dos pestañas (una en incógnito). Uno crea sala, el otro mete el código de 4 letras.

## Tests
```
pytest tests/
```

## Despliegue en Render
1. Subir el repo a GitHub.
2. En Render → New → Blueprint → conectar el repo. `render.yaml` ya está configurado (free tier).
3. Compartir la URL pública con el rival.

## Reglas implementadas
- 106 fichas (104 numeradas + 2 jokers), reparto inicial de 14.
- Grupos (3-4 fichas mismo número, colores distintos).
- Escaleras (3+ fichas mismo color, números consecutivos).
- Jokers como comodín en grupos y escaleras.
- Salida inicial mínimo 30 puntos sin manipular mesa existente.
- Manipulación libre de la mesa una vez has salido.
- Robar y pasar si no puedes/quieres jugar.
- Victoria al quedarte sin fichas.

## Fuera de alcance (MVP)
- Chat
- Más de 2 jugadores
- IA para practicar solo
- Cuentas de usuario / historial
