# A-001 — Lokale Umgebung (erfasst 2026-10-22)

| Punkt | Wert |
|---|---|
| Betriebssystem | Windows 11 Pro 10.0.26300 (Build 26300, Insider-Kanal) — physischer Rechner (ASUS-Board), keine VM |
| CPU | AMD Ryzen 9 7950X3D, 16 Kerne / 32 Threads |
| RAM | 63,1 GB |
| GPU | NVIDIA GeForce RTX 4080 (Treiber 32.0.16.1742, diskret) + AMD Radeon Graphics (iGPU) |
| Freier Plattenplatz | D: (Repo) 2,8 TB frei; C: 3,0 TB frei |
| Node | v24.20.0 |
| Python | 3.13.15 als `python`. **`python3` ist nur der Microsoft-Store-Alias** und startet nichts → lokal `python -m http.server 8000` verwenden |
| Git | 2.55.0.windows.5 |
| Push-Recht | `git push --dry-run origin auftrag/A-001` → ok (`* [new branch]`); echter Push siehe Ergebnis |
| Browser | Google Chrome 155.0.8059.85, Microsoft Edge 155.0.4283.62, Firefox 153.0.4 |
| Browser-Steuerung | Playwright 1.49.1 (außerhalb des Repos installiert) mit `channel: 'chrome'` = installiertes Chrome 155, neuer Headless-Modus, `--enable-unsafe-webgpu` |

## WebGPU

- **Startbildschirm (Eingangsdiagnose):** Chip „Beschleunigung" = **aktiv** (`detectWebGPU()` → `gpu`), siehe `start.png`.
- **`navigator.gpu.requestAdapter()`** (Standard-Adapter): vendor `nvidia`, architecture `lovelace` → RTX 4080.
- **`chrome://gpu`, Abschnitt WebGPU:**

```
Graphics Feature Status — WebGPU: Hardware accelerated

Dawn-Adapter → [WebGPU Status]:
- <Discrete GPU>  D3D12 backend - NVIDIA GeForce RTX 4080: Available
- <Integrated GPU>  D3D12 backend - AMD Radeon(TM) Graphics: Available
- <CPU>  D3D12 backend - Microsoft Basic Render Driver: Blocklisted - crbug.com/40057808: CPU adapters not fully tested or conformant.
- <CPU>  Vulkan backend - SwiftShader Device (Subzero): Blocklisted - crbug.com/40057808: CPU adapters not fully tested or conformant.
- <Discrete GPU>  Vulkan backend - NVIDIA GeForce RTX 4080: Available
- <Integrated GPU>  Vulkan backend - AMD Radeon(TM) Graphics: Available
- <Discrete GPU>  D3D11 backend - NVIDIA GeForce RTX 4080: Blocklisted - crbug.com/41479539: D3D11 backend not fully implemented.
- <Integrated GPU>  D3D11 backend - AMD Radeon(TM) Graphics: Blocklisted - crbug.com/41479539: D3D11 backend not fully implemented.
- <CPU>  D3D11 backend - Microsoft Basic Render Driver: Blocklisted (D3D11 + CPU-Adapter)
```

Die Blocklist-Einträge betreffen nur CPU-Fallbacks und das D3D11-Backend; der genutzte Pfad D3D12/NVIDIA ist „Available".
Hinweis: Lauf mit `--ignore-gpu-blocklist`; die Hardware-Adapter stehen ohnehin nicht auf der Blocklist.
