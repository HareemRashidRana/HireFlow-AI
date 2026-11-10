"""The curated skill alias table (Requirements Coverage).

An alias says: "these two spellings name the SAME skill". It is deliberately small, written by hand,
and versioned. Matching never guesses: no substring matching, no fuzzy matching, no learned
similarity. If two names are not in this table (and are not identical after normalisation) they are
different skills.

Rules for adding an entry (changing this table means bumping ALIAS_TABLE_VERSION):
  * Both sides must be the same technology, not merely related (React is not React Native;
    AngularJS is not Angular; SQL is not MySQL; Java is not JavaScript; C, C++ and C# are three
    different languages).
  * Keys are written in normalised form (see normalize.py): lower case, symbols kept.
  * An alias maps to exactly one canonical name, and a canonical name is never itself an alias.
"""

ALIAS_TABLE_VERSION = "aliases-1"

# alias -> canonical
ALIASES: dict[str, str] = {
    # JavaScript family
    "js": "javascript",
    "ts": "typescript",
    "node": "node.js",
    "nodejs": "node.js",
    "node js": "node.js",
    "reactjs": "react",
    "react.js": "react",
    "vuejs": "vue",
    "vue.js": "vue",
    "expressjs": "express",
    "express.js": "express",
    "nextjs": "next.js",
    "next js": "next.js",
    # C family: spelled-out forms only. "c", "c++" and "c#" are never aliases of each other.
    "c sharp": "c#",
    "csharp": "c#",
    "c plus plus": "c++",
    "cpp": "c++",
    # .NET: the platform name, never the bare word "net"
    "dotnet": ".net",
    "dot net": ".net",
    # Go
    "golang": "go",
    # Python
    "python3": "python",
    "python 3": "python",
    # Databases
    "postgres": "postgresql",
    "postgre sql": "postgresql",
    "mongo": "mongodb",
    "mssql": "sql server",
    "ms sql": "sql server",
    "microsoft sql server": "sql server",
    # Infrastructure
    "k8s": "kubernetes",
    "amazon web services": "aws",
    "google cloud": "gcp",
    "google cloud platform": "gcp",
    "cicd": "ci/cd",
    "ci cd": "ci/cd",
    # Data / ML libraries
    "sklearn": "scikit-learn",
    "scikit learn": "scikit-learn",
    "powerbi": "power bi",
}

# Pairs that must NEVER be treated as the same skill. They are asserted by the tests, so a careless
# future alias cannot silently merge them. (Each is a real, common confusion.)
DISTINCT_SKILLS: tuple[tuple[str, str], ...] = (
    ("java", "javascript"),
    ("c", "c++"),
    ("c", "c#"),
    ("c++", "c#"),
    (".net", "net"),
    (".net", "asp.net"),
    (".net", "vb.net"),
    ("go", "gin"),
    ("angular", "angularjs"),
    ("react", "react native"),
    ("javascript", "typescript"),
    ("sql", "mysql"),
    ("sql", "postgresql"),
    ("sql", "sql server"),
    ("objective-c", "c"),
    ("f#", "c#"),
    ("r", "ruby"),
    ("java", "kotlin"),
    ("node.js", "javascript"),
    ("python", "pythonista"),
)
