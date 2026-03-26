"""
conftest.py
===========
Loaded by pytest before any test module is imported.

Why this file exists
--------------------
  collaboration.py contains a module-level line:
      git = PyGit()

  PyGit.__init__ calls psycopg2.connect() IMMEDIATELY on instantiation.
  When pytest collects tests it imports collaboration.py, which would
  attempt a real database connection and crash if the DB is not running.

  This file:
    1. Imports py_git (which is safe — only the instantiation connects).
    2. Registers the module under BOTH its qualified name ('backend.py_git')
       AND its bare name ('py_git') in sys.modules, so the patch below
       applies to the exact same object that collaboration.py imports from.
    3. Replaces py_git.PyGit with a MagicMock BEFORE collaboration.py
       is imported, so `git = PyGit()` produces a harmless mock.

  Each individual test then swaps that module-level `git` variable out
  for its own tightly-controlled mock via make_app()'s patch(), so test
  logic is completely unaffected by this session-wide patch.

Why step 2 is needed (the module-identity problem)
---------------------------------------------------
  collaboration.py does:
      sys.path.insert(0, ...)   # adds the backend/ directory
      from py_git import PyGit  # Python resolves this as 'py_git'

  conftest.py does:
      from backend import py_git  # Python resolves this as 'backend.py_git'

  Without step 2 these are TWO SEPARATE entries in sys.modules pointing to
  the same .py file but different module objects.  patch.object on one has
  no effect on the other, so PyGit() in collaboration.py still calls the
  real constructor and tries to open a DB connection.

  sys.modules.setdefault('py_git', py_git) makes both keys share the same
  object, so the patch is visible whichever name is used to import.
"""
import sys
from unittest.mock import MagicMock, patch

# Step 1: import the py_git module itself (safe — no connection yet).
from backend import py_git

# Step 2: register the module under the bare name 'py_git' so that
# collaboration.py's `from py_git import PyGit` resolves to the same
# object we are about to patch (not a freshly-loaded duplicate).
sys.modules.setdefault("py_git", py_git)

# Step 3: replace the PyGit class with a MagicMock for the whole session.
# Because both 'py_git' and 'backend.py_git' now point to the same object,
# this single patch.object call covers both import styles.
patch.object(py_git, "PyGit", MagicMock).start()