"""Pytest fixtures for the DropWave backend regression suite."""
import os
import sys

# Import the backend package (main.py) by path so the tests run standalone.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
