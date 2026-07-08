"""Minimal in-process circuit breaker for external AI services.

After `threshold` consecutive failures the circuit opens and calls fail fast for
`cooldown` seconds instead of hammering a downed provider (and burning Celery
retries for hours). One probe call is allowed after the cooldown; success closes
the circuit.

In-process state is per worker process — good enough for our single-worker
setup; swap to redis if workers scale out.
"""

import functools
import threading
import time


class CircuitOpenError(RuntimeError):
    pass


class CircuitBreaker:
    def __init__(self, name: str, threshold: int = 5, cooldown: float = 120.0):
        self.name = name
        self.threshold = threshold
        self.cooldown = cooldown
        self._failures = 0
        self._opened_at: float | None = None
        self._lock = threading.Lock()

    def __call__(self, fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            with self._lock:
                if self._opened_at is not None:
                    if time.monotonic() - self._opened_at < self.cooldown:
                        raise CircuitOpenError(
                            f"{self.name} temporarily unavailable (circuit open)"
                        )
                    # cooldown over — allow one probe
                    self._opened_at = None
            try:
                result = fn(*args, **kwargs)
            except Exception:
                with self._lock:
                    self._failures += 1
                    if self._failures >= self.threshold:
                        self._opened_at = time.monotonic()
                        self._failures = 0
                raise
            with self._lock:
                self._failures = 0
            return result

        return wrapper


azure_speech_breaker = CircuitBreaker("Azure Speech")
gemini_breaker = CircuitBreaker("Gemini")
# Best-effort Gemini calls (orthoepy, exemplar answers) run on a SEPARATE circuit
# so their failures can never open the grader's circuit and fail the next
# student's analyze(). The grader must stay healthy even when these extras don't.
gemini_besteffort_breaker = CircuitBreaker("Gemini (best-effort)")
# LLM grader on Azure OpenAI — kept separate from Gemini's breaker so that when
# Azure is down (and its circuit is open) the grader can still fall back to
# Gemini, and vice-versa.
azure_llm_breaker = CircuitBreaker("Azure OpenAI")
