# Helio Lab — Public XAUUSD Strategy Lab

A static, browser-run XAUUSD strategy backtester. Market data is bundled in `data/`; strategy code runs in the visitor's browser with Pyodide rather than on a server.

## Publish with GitHub Pages

In the repository settings, open **Pages** and select **Deploy from a branch**. Choose the `main` branch and the `/ (root)` folder. The public URL is then:

`https://prince416.github.io/xau/`

## Python runner contract

An uploaded script is run with:

```text
python strategy.py --csv market.csv --out trades.csv --balance 100000
```

It must write `trades.csv`; expected fields are `entry_time`, `exit_time`, `direction`, `entry`, `exit`, `reason`, `pnl`, and `r`. The supplied liquidity-sweep strategy follows this contract.

No code is executed by GitHub Pages or a backend. Pyodide downloads on first run, so visitors need an internet connection for that initial browser runtime download.
