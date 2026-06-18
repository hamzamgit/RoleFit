"""RoleFit-AI — multi-profile job-matching product built on the Hermes agent.

Isolated package: keep RoleFit code here (not in Hermes core dirs) so upstream
Hermes pulls stay clean. RoleFit owns its own SQLite DB (`rolefit.db`) separate
from Hermes `state.db` to avoid migration collisions.
"""

__version__ = "0.1.0"
