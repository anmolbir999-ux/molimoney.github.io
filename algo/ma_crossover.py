"""Original 50/200 SMA crossover entry point – now a shortcut to backtest.py.

  python ma_crossover.py RELIANCE.NS HDFCBANK.NS   ==   python backtest.py RELIANCE.NS HDFCBANK.NS -s sma_cross
"""
import sys

import backtest

if __name__ == "__main__":
    sys.argv[1:1] = ["-s", "sma_cross"]
    backtest.main()
