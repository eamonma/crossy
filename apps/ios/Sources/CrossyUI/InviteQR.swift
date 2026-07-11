// The invite QR's matrix: data in, bool modules out, nothing else (AD-2: the
// app target may rasterize however it likes; CrossyUI draws the same matrix in
// a Canvas). A pure Swift port of the QR generator the web already trusts
// (uqr, itself the Nayuki qrcodegen core), so the code a phone camera reads off
// an iPhone screen is module-for-module the code the party projector shows
// (apps/web/src/ui/PartyView.tsx). Same register everywhere: ECC M (the
// projector's), minimal version, mask chosen by the spec's penalty rules.
// Pinned byte-for-byte against uqr's output in InviteQRTests; a divergence is
// a bug here, never a reason to fork the modules.

import Foundation

/// One encoded QR symbol: `size` x `size` modules, `true` is dark. `version`
/// and `mask` ride along so the conformance vectors can pin the encoder's
/// choices, not just the picture.
public struct QRMatrix: Equatable, Sendable {
    public let version: Int
    public let size: Int
    public let mask: Int
    public let modules: [[Bool]]
}

public enum InviteQR {
    /// Encode `text` at ECC M (the invite register, PartyView's choice).
    /// Numeric and alphanumeric payloads take their compact modes, anything
    /// else is UTF-8 bytes, exactly uqr's mode selection. Returns nil only
    /// when the payload exceeds version 40's capacity, which no invite URL
    /// approaches.
    public static func matrix(for text: String) -> QRMatrix? {
        guard let segment = Segment.make(text) else {
            // The empty string: no segments, a valid degenerate encode in
            // uqr (an empty version-1 symbol), but nothing an invite ever
            // shares. Encode it anyway for parity.
            return encode(segments: [], ecc: .medium)
        }
        return encode(segments: [segment], ecc: .medium)
    }

    // MARK: - Error correction levels

    /// (table row, format bits), uqr's EccMap pairs.
    enum ECC {
        case low, medium, quartile, high

        var tableRow: Int {
            switch self {
            case .low: return 0
            case .medium: return 1
            case .quartile: return 2
            case .high: return 3
            }
        }

        var formatBits: Int {
            switch self {
            case .low: return 1
            case .medium: return 0
            case .quartile: return 3
            case .high: return 2
            }
        }
    }

    // MARK: - Segments (mode selection, uqr's makeSegments)

    struct Segment {
        let modeBits: Int
        let charCountBits: (Int, Int, Int)  // versions 1-9, 10-26, 27-40
        let numChars: Int
        let bits: [Bool]

        static let alphanumericCharset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"

        static func make(_ text: String) -> Segment? {
            guard !text.isEmpty else { return nil }
            if text.allSatisfy({ $0.isASCII && $0.isNumber }) {
                return numeric(text)
            }
            if text.allSatisfy({ alphanumericCharset.contains($0) }) {
                return alphanumeric(text)
            }
            return bytes(Array(text.utf8))
        }

        static func numeric(_ digits: String) -> Segment {
            var bits: [Bool] = []
            let characters = Array(digits)
            var i = 0
            while i < characters.count {
                let n = min(characters.count - i, 3)
                let value = Int(String(characters[i..<(i + n)]))!
                appendBits(value, n * 3 + 1, to: &bits)
                i += n
            }
            return Segment(
                modeBits: 0x1, charCountBits: (10, 12, 14),
                numChars: characters.count, bits: bits)
        }

        static func alphanumeric(_ text: String) -> Segment {
            let indices = text.map { character in
                alphanumericCharset.distance(
                    from: alphanumericCharset.startIndex,
                    to: alphanumericCharset.firstIndex(of: character)!)
            }
            var bits: [Bool] = []
            var i = 0
            while i + 2 <= indices.count {
                appendBits(indices[i] * 45 + indices[i + 1], 11, to: &bits)
                i += 2
            }
            if i < indices.count {
                appendBits(indices[i], 6, to: &bits)
            }
            return Segment(
                modeBits: 0x2, charCountBits: (9, 11, 13),
                numChars: indices.count, bits: bits)
        }

        static func bytes(_ data: [UInt8]) -> Segment {
            var bits: [Bool] = []
            for byte in data {
                appendBits(Int(byte), 8, to: &bits)
            }
            return Segment(
                modeBits: 0x4, charCountBits: (8, 16, 16),
                numChars: data.count, bits: bits)
        }

        func charCountBits(version: Int) -> Int {
            if version <= 9 { return charCountBits.0 }
            if version <= 26 { return charCountBits.1 }
            return charCountBits.2
        }
    }

    // MARK: - Capacity tables (the spec's, via uqr)

    static let eccCodewordsPerBlock: [[Int]] = [
        [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
        [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    ]

    static let numErrorCorrectionBlocks: [[Int]] = [
        [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
        [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
        [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
        [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
    ]

    static func numRawDataModules(version: Int) -> Int {
        var result = (16 * version + 128) * version + 64
        if version >= 2 {
            let numAlign = version / 7 + 2
            result -= (25 * numAlign - 10) * numAlign - 55
            if version >= 7 { result -= 36 }
        }
        return result
    }

    static func numDataCodewords(version: Int, ecc: ECC) -> Int {
        numRawDataModules(version: version) / 8
            - eccCodewordsPerBlock[ecc.tableRow][version]
                * numErrorCorrectionBlocks[ecc.tableRow][version]
    }

    // MARK: - Encoding (uqr's encodeSegments; no ECC boost, auto mask)

    static func encode(segments: [Segment], ecc: ECC) -> QRMatrix? {
        // Minimal version that fits (the projector's posture: boostEcc off).
        var version = 1
        var dataUsedBits = 0
        while true {
            let capacityBits = numDataCodewords(version: version, ecc: ecc) * 8
            if let used = totalBits(segments: segments, version: version),
                used <= capacityBits
            {
                dataUsedBits = used
                break
            }
            if version >= 40 { return nil }
            version += 1
        }
        _ = dataUsedBits

        var bits: [Bool] = []
        for segment in segments {
            appendBits(segment.modeBits, 4, to: &bits)
            appendBits(segment.numChars, segment.charCountBits(version: version), to: &bits)
            bits.append(contentsOf: segment.bits)
        }

        // Terminator, byte alignment, then the spec's alternating pad bytes.
        let capacityBits = numDataCodewords(version: version, ecc: ecc) * 8
        appendBits(0, min(4, capacityBits - bits.count), to: &bits)
        appendBits(0, (8 - bits.count % 8) % 8, to: &bits)
        var padByte = 0xEC
        while bits.count < capacityBits {
            appendBits(padByte, 8, to: &bits)
            padByte ^= 0xEC ^ 0x11
        }

        var dataCodewords = [Int](repeating: 0, count: bits.count / 8)
        for (i, bit) in bits.enumerated() where bit {
            dataCodewords[i >> 3] |= 1 << (7 - (i & 7))
        }

        var symbol = Symbol(version: version, ecc: ecc, dataCodewords: dataCodewords)
        return symbol.matrix()
    }

    static func totalBits(segments: [Segment], version: Int) -> Int? {
        var result = 0
        for segment in segments {
            let ccbits = segment.charCountBits(version: version)
            if segment.numChars >= (1 << ccbits) { return nil }
            result += 4 + ccbits + segment.bits.count
        }
        return result
    }

    static func appendBits(_ value: Int, _ length: Int, to bits: inout [Bool]) {
        guard length > 0 else { return }
        for i in stride(from: length - 1, through: 0, by: -1) {
            bits.append((value >> i) & 1 != 0)
        }
    }

    // MARK: - The symbol (drawing, masking, penalty)

    struct Symbol {
        let version: Int
        let ecc: ECC
        let size: Int
        var modules: [[Bool]]
        var isFunction: [[Bool]]

        init(version: Int, ecc: ECC, dataCodewords: [Int]) {
            self.version = version
            self.ecc = ecc
            self.size = version * 4 + 17
            self.modules = [[Bool]](
                repeating: [Bool](repeating: false, count: size), count: size)
            self.isFunction = modules
            drawFunctionPatterns()
            let allCodewords = addEccAndInterleave(dataCodewords)
            drawCodewords(allCodewords)
        }

        /// Choose the mask by the spec's four penalty rules (uqr's automask),
        /// apply it, and return the finished matrix.
        mutating func matrix() -> QRMatrix {
            var chosen = -1
            var minPenalty = Int.max
            for candidate in 0..<8 {
                applyMask(candidate)
                drawFormatBits(mask: candidate)
                let penalty = penaltyScore()
                if penalty < minPenalty {
                    chosen = candidate
                    minPenalty = penalty
                }
                applyMask(candidate)  // XOR undoes itself
            }
            applyMask(chosen)
            drawFormatBits(mask: chosen)
            return QRMatrix(version: version, size: size, mask: chosen, modules: modules)
        }

        // MARK: Function patterns

        mutating func drawFunctionPatterns() {
            for i in 0..<size {
                setFunction(6, i, i % 2 == 0)
                setFunction(i, 6, i % 2 == 0)
            }
            drawFinder(3, 3)
            drawFinder(size - 4, 3)
            drawFinder(3, size - 4)
            let positions = alignmentPatternPositions()
            let count = positions.count
            for i in 0..<count {
                for j in 0..<count {
                    let corner =
                        (i == 0 && j == 0) || (i == 0 && j == count - 1)
                        || (i == count - 1 && j == 0)
                    if !corner {
                        drawAlignment(positions[i], positions[j])
                    }
                }
            }
            drawFormatBits(mask: 0)
            drawVersion()
        }

        mutating func drawFormatBits(mask: Int) {
            let data = ecc.formatBits << 3 | mask
            var rem = data
            for _ in 0..<10 {
                rem = (rem << 1) ^ ((rem >> 9) * 0x537)
            }
            let bits = (data << 10 | rem) ^ 0x5412
            for i in 0...5 { setFunction(8, i, bit(bits, i)) }
            setFunction(8, 7, bit(bits, 6))
            setFunction(8, 8, bit(bits, 7))
            setFunction(7, 8, bit(bits, 8))
            for i in 9..<15 { setFunction(14 - i, 8, bit(bits, i)) }
            for i in 0..<8 { setFunction(size - 1 - i, 8, bit(bits, i)) }
            for i in 8..<15 { setFunction(8, size - 15 + i, bit(bits, i)) }
            setFunction(8, size - 8, true)
        }

        mutating func drawVersion() {
            guard version >= 7 else { return }
            var rem = version
            for _ in 0..<12 {
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
            }
            let bits = version << 12 | rem
            for i in 0..<18 {
                let color = bit(bits, i)
                let a = size - 11 + i % 3
                let b = i / 3
                setFunction(a, b, color)
                setFunction(b, a, color)
            }
        }

        mutating func drawFinder(_ x: Int, _ y: Int) {
            for dy in -4...4 {
                for dx in -4...4 {
                    let dist = max(abs(dx), abs(dy))
                    let xx = x + dx
                    let yy = y + dy
                    if xx >= 0, xx < size, yy >= 0, yy < size {
                        setFunction(xx, yy, dist != 2 && dist != 4)
                    }
                }
            }
        }

        mutating func drawAlignment(_ x: Int, _ y: Int) {
            for dy in -2...2 {
                for dx in -2...2 {
                    setFunction(x + dx, y + dy, max(abs(dx), abs(dy)) != 1)
                }
            }
        }

        mutating func setFunction(_ x: Int, _ y: Int, _ isDark: Bool) {
            modules[y][x] = isDark
            isFunction[y][x] = true
        }

        func alignmentPatternPositions() -> [Int] {
            guard version > 1 else { return [] }
            let numAlign = version / 7 + 2
            let step =
                version == 32
                ? 26
                : (version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2) * 2
            var result = [6]
            var pos = size - 7
            while result.count < numAlign {
                result.insert(pos, at: 1)
                pos -= step
            }
            return result
        }

        // MARK: Codewords

        func addEccAndInterleave(_ data: [Int]) -> [Int] {
            let numBlocks = InviteQR.numErrorCorrectionBlocks[ecc.tableRow][version]
            let blockEccLen = InviteQR.eccCodewordsPerBlock[ecc.tableRow][version]
            let rawCodewords = InviteQR.numRawDataModules(version: version) / 8
            let numShortBlocks = numBlocks - rawCodewords % numBlocks
            let shortBlockLen = rawCodewords / numBlocks

            var blocks: [[Int]] = []
            let divisor = Self.reedSolomonDivisor(degree: blockEccLen)
            var k = 0
            for i in 0..<numBlocks {
                let length = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
                var block = Array(data[k..<(k + length)])
                k += length
                let eccBytes = Self.reedSolomonRemainder(data: block, divisor: divisor)
                if i < numShortBlocks { block.append(0) }
                blocks.append(block + eccBytes)
            }

            var result: [Int] = []
            for i in 0..<blocks[0].count {
                for (j, block) in blocks.enumerated()
                where i != shortBlockLen - blockEccLen || j >= numShortBlocks {
                    result.append(block[i])
                }
            }
            return result
        }

        mutating func drawCodewords(_ data: [Int]) {
            var i = 0
            var right = size - 1
            while right >= 1 {
                if right == 6 { right = 5 }
                for vert in 0..<size {
                    for j in 0..<2 {
                        let x = right - j
                        let upward = ((right + 1) & 2) == 0
                        let y = upward ? size - 1 - vert : vert
                        if !isFunction[y][x], i < data.count * 8 {
                            modules[y][x] = bit(data[i >> 3], 7 - (i & 7))
                            i += 1
                        }
                    }
                }
                right -= 2
            }
        }

        mutating func applyMask(_ mask: Int) {
            for y in 0..<size {
                for x in 0..<size where !isFunction[y][x] {
                    let invert: Bool
                    switch mask {
                    case 0: invert = (x + y) % 2 == 0
                    case 1: invert = y % 2 == 0
                    case 2: invert = x % 3 == 0
                    case 3: invert = (x + y) % 3 == 0
                    case 4: invert = (x / 3 + y / 2) % 2 == 0
                    case 5: invert = x * y % 2 + x * y % 3 == 0
                    case 6: invert = (x * y % 2 + x * y % 3) % 2 == 0
                    default: invert = ((x + y) % 2 + x * y % 3) % 2 == 0
                    }
                    if invert { modules[y][x].toggle() }
                }
            }
        }

        // MARK: Penalty (the spec's four rules)

        static let penaltyN1 = 3
        static let penaltyN2 = 3
        static let penaltyN3 = 40
        static let penaltyN4 = 10

        func penaltyScore() -> Int {
            var result = 0

            // Rule 1 and 3, rows then columns.
            for y in 0..<size {
                var runColor = false
                var runLength = 0
                var history = [Int](repeating: 0, count: 7)
                for x in 0..<size {
                    if modules[y][x] == runColor {
                        runLength += 1
                        if runLength == 5 {
                            result += Self.penaltyN1
                        } else if runLength > 5 {
                            result += 1
                        }
                    } else {
                        finderPenaltyAddHistory(runLength, &history)
                        if !runColor {
                            result += finderPenaltyCountPatterns(history) * Self.penaltyN3
                        }
                        runColor = modules[y][x]
                        runLength = 1
                    }
                }
                result +=
                    finderPenaltyTerminateAndCount(runColor, runLength, &history)
                    * Self.penaltyN3
            }
            for x in 0..<size {
                var runColor = false
                var runLength = 0
                var history = [Int](repeating: 0, count: 7)
                for y in 0..<size {
                    if modules[y][x] == runColor {
                        runLength += 1
                        if runLength == 5 {
                            result += Self.penaltyN1
                        } else if runLength > 5 {
                            result += 1
                        }
                    } else {
                        finderPenaltyAddHistory(runLength, &history)
                        if !runColor {
                            result += finderPenaltyCountPatterns(history) * Self.penaltyN3
                        }
                        runColor = modules[y][x]
                        runLength = 1
                    }
                }
                result +=
                    finderPenaltyTerminateAndCount(runColor, runLength, &history)
                    * Self.penaltyN3
            }

            // Rule 2: 2x2 blocks of one color.
            for y in 0..<(size - 1) {
                for x in 0..<(size - 1) {
                    let color = modules[y][x]
                    if color == modules[y][x + 1], color == modules[y + 1][x],
                        color == modules[y + 1][x + 1]
                    {
                        result += Self.penaltyN2
                    }
                }
            }

            // Rule 4: dark-module balance.
            var dark = 0
            for row in modules {
                dark += row.lazy.filter { $0 }.count
            }
            let total = size * size
            let k = (abs(dark * 20 - total * 10) + total - 1) / total - 1
            result += k * Self.penaltyN4
            return result
        }

        func finderPenaltyCountPatterns(_ history: [Int]) -> Int {
            let n = history[1]
            let core =
                n > 0 && history[2] == n && history[3] == n * 3 && history[4] == n
                && history[5] == n
            return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0)
                + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
        }

        func finderPenaltyTerminateAndCount(
            _ currentRunColor: Bool, _ currentRunLength: Int, _ history: inout [Int]
        ) -> Int {
            var runLength = currentRunLength
            if currentRunColor {
                finderPenaltyAddHistory(runLength, &history)
                runLength = 0
            }
            runLength += size
            finderPenaltyAddHistory(runLength, &history)
            return finderPenaltyCountPatterns(history)
        }

        func finderPenaltyAddHistory(_ currentRunLength: Int, _ history: inout [Int]) {
            var runLength = currentRunLength
            if history[0] == 0 { runLength += size }
            history.removeLast()
            history.insert(runLength, at: 0)
        }

        func bit(_ value: Int, _ index: Int) -> Bool {
            (value >> index) & 1 != 0
        }

        // MARK: Reed-Solomon (GF(2^8), the spec's field)

        static func reedSolomonDivisor(degree: Int) -> [Int] {
            var result = [Int](repeating: 0, count: degree - 1) + [1]
            var root = 1
            for _ in 0..<degree {
                for j in 0..<result.count {
                    result[j] = reedSolomonMultiply(result[j], root)
                    if j + 1 < result.count {
                        result[j] ^= result[j + 1]
                    }
                }
                root = reedSolomonMultiply(root, 2)
            }
            return result
        }

        static func reedSolomonRemainder(data: [Int], divisor: [Int]) -> [Int] {
            var result = [Int](repeating: 0, count: divisor.count)
            for byte in data {
                let factor = byte ^ result.removeFirst()
                result.append(0)
                for (i, coefficient) in divisor.enumerated() {
                    result[i] ^= reedSolomonMultiply(coefficient, factor)
                }
            }
            return result
        }

        static func reedSolomonMultiply(_ x: Int, _ y: Int) -> Int {
            var z = 0
            for i in stride(from: 7, through: 0, by: -1) {
                z = (z << 1) ^ ((z >> 7) * 0x11D)
                z ^= ((y >> i) & 1) * x
            }
            return z
        }
    }
}
