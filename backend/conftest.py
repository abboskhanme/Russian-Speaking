"""Ensure tests import the live, volume-mounted source (/app) rather than the
pip-installed snapshot in site-packages — matching how uvicorn/celery run in dev."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
