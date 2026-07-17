package crossy.engine.vectors

// The vector families (= directory names under vectors/v1). A closed set on purpose:
// discovery fails on any directory not listed here, mirroring the TS `FAMILIES` const and the
// Swift `VectorFamily` enum. `CLIENT_STORE` (dir `client-store`) and `CLUE_RUNS` (dir
// `clue-runs`) are foreign to the engine: discovered and shape-validated here, executed by
// their own consumer's suite (:store and :ui), never bound to :engine (vectors/README.md).
enum class VectorFamily(val dir: String) {
    REDUCER("reducer"),
    COMPARATOR("comparator"),
    NAVIGATION("navigation"),
    COMPLETION("completion"),
    CHECK("check"),
    CLIENT_STORE("client-store"),
    CLUE_RUNS("clue-runs"),
    ;

    companion object {
        fun fromDir(dir: String): VectorFamily? = entries.firstOrNull { it.dir == dir }
    }
}
