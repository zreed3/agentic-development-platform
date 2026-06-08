import AppKit
import Darwin
import Foundation
import SwiftUI

struct SensorReading: Decodable {
    let key: String
    let type: String
    let value: String
    let quantity: Double
    let unit: String
}

struct FanState: Sendable {
    let id: Int
    let mode: String
    let currentRPM: Int
    let targetRPM: Int
    let minRPM: Int
    let maxRPM: Int

    static func parse(_ output: String) -> FanState? {
        for line in output.split(separator: "\n").dropFirst() {
            let columns = line.split { $0 == " " || $0 == "\t" }.map(String.init)
            guard columns.count >= 6,
                  let id = Int(columns[0]),
                  let current = Int(columns[2]),
                  let target = Int(columns[3]),
                  let min = Int(columns[4]),
                  let max = Int(columns[5])
            else {
                continue
            }

            return FanState(
                id: id,
                mode: columns[1],
                currentRPM: current,
                targetRPM: target,
                minRPM: min,
                maxRPM: max
            )
        }

        return nil
    }
}

struct SensorMetric: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let value: Double
}

struct UsageSnapshot: Sendable {
    let cpuUsage: Double?
    let gpuUsage: Double?
    let cpuCoreUsage: [SensorMetric]
}

struct TelemetrySnapshot: Identifiable, Sendable {
    let id = UUID()
    let timestamp: Date
    let currentTemp: Double
    let gpuTemp: Double
    let chipMaxTemp: Double
    let cpuUsage: Double?
    let gpuUsage: Double?
    let currentSensorName: String
    let gpuSensorName: String
    let chipMaxSensorName: String
    let cpuCoreTemps: [SensorMetric]
    let gpuCoreTemps: [SensorMetric]
    let cpuCoreUsage: [SensorMetric]
    let fan: FanState?
}

struct Backend: Sendable {
    let fanPath: String
    let iSMCPath: String

    static func locate() throws -> Backend {
        let fanCandidates = [
            "/Applications/FanControl.app/Contents/MacOS/fan",
            "\(NSHomeDirectory())/Applications/FanControl.app/Contents/MacOS/fan",
            "/opt/homebrew/bin/fan",
            "/usr/local/bin/fan"
        ]

        for fanPath in fanCandidates where FileManager.default.isExecutableFile(atPath: fanPath) {
            let iSMCCandidates = iSMCPaths(for: fanPath)
            if let iSMCPath = iSMCCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
                return Backend(fanPath: fanPath, iSMCPath: iSMCPath)
            }
        }

        throw AppError.backendMissing
    }

    private static func iSMCPaths(for fanPath: String) -> [String] {
        if fanPath.hasSuffix(".app/Contents/MacOS/fan"),
           let appRange = fanPath.range(of: ".app/Contents/MacOS/fan") {
            let appPath = String(fanPath[..<appRange.lowerBound]) + ".app"
            return [
                "\(appPath)/Contents/Library/PrivilegedHelperTools/iSMC",
                "\(appPath)/Contents/Resources/iSMC"
            ]
        }

        return [
            "/Applications/FanControl.app/Contents/Library/PrivilegedHelperTools/iSMC",
            "\(NSHomeDirectory())/Applications/FanControl.app/Contents/Library/PrivilegedHelperTools/iSMC"
        ]
    }
}

enum AppError: LocalizedError {
    case backendMissing
    case noTemperatureSensors

    var errorDescription: String? {
        switch self {
        case .backendMissing:
            return "FanControl.app was not found. Install it in /Applications so telemetry and fan controls can run."
        case .noTemperatureSensors:
            return "No temperature sensors were returned by iSMC."
        }
    }
}

enum GraphMode: String, CaseIterable, Identifiable {
    case overview = "Overview"
    case cpuCores = "CPU cores"
    case gpuCores = "GPU sensors"

    var id: String { rawValue }
}

enum AppPaths {
    static func appBundleURL() -> URL {
        let bundleURL = Bundle.main.bundleURL
        if bundleURL.pathExtension == "app" {
            return bundleURL
        }

        let executablePath = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path
        if let appRange = executablePath.range(of: ".app/Contents/MacOS") {
            let bundlePath = String(executablePath[..<appRange.lowerBound]) + ".app"
            return URL(fileURLWithPath: bundlePath)
        }

        return bundleURL
    }

    static func appFolderURL() -> URL {
        appBundleURL().deletingLastPathComponent()
    }

    static func logURL() -> URL {
        appFolderURL().appendingPathComponent("temperature-log.csv")
    }
}

enum CommandRunner {
    static func run(_ executable: String, _ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        try process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)

        guard process.terminationStatus == 0 else {
            throw NSError(
                domain: "MacFanProfile.Command",
                code: Int(process.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: output.isEmpty ? "Command failed." : output]
            )
        }

        return output
    }

    static func runPrivilegedFanCommand(fanPath: String, argument: String) throws -> String {
        let shellCommand = "\(shellQuote(fanPath)) \(shellQuote(argument)) 2>&1"
        return try runPrivilegedShellCommand(shellCommand)
    }

    static func runPrivilegedShellCommand(_ shellCommand: String) throws -> String {
        let script = "do shell script \(appleScriptLiteral(shellCommand)) with administrator privileges"
        return try run("/usr/bin/osascript", ["-e", script])
    }

    private static func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    private static func appleScriptLiteral(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }
}

final class UsageSampler {
    private var previousCPUTicks: [[UInt64]] = []

    func sample() -> UsageSnapshot {
        let cpu = readCPUUsage()
        let gpu = readGPUUsage()

        return UsageSnapshot(
            cpuUsage: cpu.total,
            gpuUsage: gpu,
            cpuCoreUsage: cpu.cores
        )
    }

    private func readCPUUsage() -> (total: Double?, cores: [SensorMetric]) {
        var cpuInfo: processor_info_array_t?
        var numCpuInfo: mach_msg_type_number_t = 0
        var numCPUs: natural_t = 0

        let result = host_processor_info(
            mach_host_self(),
            PROCESSOR_CPU_LOAD_INFO,
            &numCPUs,
            &cpuInfo,
            &numCpuInfo
        )

        guard result == KERN_SUCCESS, let cpuInfo else {
            return (nil, [])
        }

        defer {
            let size = vm_size_t(Int(numCpuInfo) * MemoryLayout<integer_t>.stride)
            vm_deallocate(mach_task_self_, vm_address_t(UInt(bitPattern: cpuInfo)), size)
        }

        let currentTicks = cpuInfo.withMemoryRebound(
            to: processor_cpu_load_info.self,
            capacity: Int(numCPUs)
        ) { pointer in
            (0..<Int(numCPUs)).map { index -> [UInt64] in
                let ticks = pointer[index].cpu_ticks
                return [
                    UInt64(ticks.0),
                    UInt64(ticks.1),
                    UInt64(ticks.2),
                    UInt64(ticks.3)
                ]
            }
        }

        defer { previousCPUTicks = currentTicks }

        guard previousCPUTicks.count == currentTicks.count else {
            return (nil, currentTicks.enumerated().map {
                SensorMetric(id: "cpu-usage-\($0.offset + 1)", name: "Core \($0.offset + 1)", value: 0)
            })
        }

        var totalDelta: UInt64 = 0
        var idleDelta: UInt64 = 0
        var cores: [SensorMetric] = []

        for (index, ticks) in currentTicks.enumerated() {
            let previous = previousCPUTicks[index]
            let diffs = zip(ticks, previous).map { current, previous in
                current >= previous ? current - previous : 0
            }

            let total = diffs.reduce(0, +)
            let idle = diffs[2]
            totalDelta += total
            idleDelta += idle

            let usage = total > 0 ? (Double(total - idle) / Double(total)) * 100 : 0
            cores.append(
                SensorMetric(
                    id: "cpu-usage-\(index + 1)",
                    name: "Core \(index + 1)",
                    value: clampPercent(usage)
                )
            )
        }

        let totalUsage = totalDelta > 0
            ? clampPercent((Double(totalDelta - idleDelta) / Double(totalDelta)) * 100)
            : nil

        return (totalUsage, cores)
    }

    private func readGPUUsage() -> Double? {
        guard let output = try? CommandRunner.run("/usr/sbin/ioreg", ["-r", "-c", "AGXAccelerator", "-d", "1"]) else {
            return nil
        }

        let pattern = #""Device Utilization %"\s*=\s*([0-9]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: output, range: NSRange(output.startIndex..., in: output)),
              let range = Range(match.range(at: 1), in: output),
              let value = Double(output[range])
        else {
            return nil
        }

        return clampPercent(value)
    }

    private func clampPercent(_ value: Double) -> Double {
        min(100, max(0, value))
    }
}

enum TelemetryReader {
    static func read(backend: Backend, usage: UsageSnapshot) throws -> TelemetrySnapshot {
        let tempOutput = try CommandRunner.run(backend.iSMCPath, ["temp", "-o", "json"])
        let tempData = Data(tempOutput.utf8)
        let sensors = try JSONDecoder().decode([String: SensorReading].self, from: tempData)

        guard !sensors.isEmpty else {
            throw AppError.noTemperatureSensors
        }

        let current = preferredSensor(
            sensors,
            names: ["CPU Die Average", "Virtual Die 1", "CPU Die Max"]
        )
        let gpu = gpuSensor(sensors) ?? preferredSensor(
            sensors,
            names: ["GPU Fabric 3", "GPU Fabric 2", "GPU Fabric 1"]
        )
        let chipMax = preferredSensor(
            sensors,
            names: ["CPU Die Max", "CPU Performance Core 2", "Virtual Die 1"]
        ) ?? sensors.max { $0.value.quantity < $1.value.quantity }
        let cpuCoreTemps = coreTemperatureSensors(
            sensors,
            prefix: "CPU",
            include: "Core",
            exclude: ["Cluster", "Fabric"]
        )
        let gpuCoreTemps = gpuTemperatureSensors(sensors)

        guard let current, let gpu, let chipMax else {
            throw AppError.noTemperatureSensors
        }

        let fanOutput = try? CommandRunner.run(backend.fanPath, ["list"])
        let fan = fanOutput.flatMap(FanState.parse)

        return TelemetrySnapshot(
            timestamp: Date(),
            currentTemp: current.value.quantity,
            gpuTemp: gpu.value.quantity,
            chipMaxTemp: chipMax.value.quantity,
            cpuUsage: usage.cpuUsage,
            gpuUsage: usage.gpuUsage,
            currentSensorName: current.key,
            gpuSensorName: gpu.key,
            chipMaxSensorName: chipMax.key,
            cpuCoreTemps: cpuCoreTemps,
            gpuCoreTemps: gpuCoreTemps,
            cpuCoreUsage: usage.cpuCoreUsage,
            fan: fan
        )
    }

    private static func preferredSensor(
        _ sensors: [String: SensorReading],
        names: [String]
    ) -> (key: String, value: SensorReading)? {
        for name in names {
            if let sensor = sensors[name] {
                return (name, sensor)
            }
        }
        return nil
    }

    private static func gpuSensor(_ sensors: [String: SensorReading]) -> (key: String, value: SensorReading)? {
        let gpuCoreSensors = sensors.filter { name, reading in
            name.hasPrefix("GPU ") && reading.unit.contains("C")
        }

        if let hottest = gpuCoreSensors.max(by: { $0.value.quantity < $1.value.quantity }) {
            return hottest
        }

        let gpuFabricSensors = sensors.filter { name, reading in
            name.hasPrefix("GPU Fabric") && reading.unit.contains("C")
        }

        return gpuFabricSensors.max(by: { $0.value.quantity < $1.value.quantity })
    }

    private static func coreTemperatureSensors(
        _ sensors: [String: SensorReading],
        prefix: String,
        include: String,
        exclude: [String]
    ) -> [SensorMetric] {
        sensors
            .filter { name, reading in
                name.hasPrefix(prefix)
                    && name.contains(include)
                    && reading.unit.contains("C")
                    && !exclude.contains(where: name.contains)
            }
            .map { name, reading in
                SensorMetric(id: reading.key, name: name, value: reading.quantity)
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private static func gpuTemperatureSensors(_ sensors: [String: SensorReading]) -> [SensorMetric] {
        let gpuCorePattern = #"^GPU [0-9]+$"#
        let regex = try? NSRegularExpression(pattern: gpuCorePattern)

        let coreSensors = sensors
            .filter { name, reading in
                guard reading.unit.contains("C"), let regex else { return false }
                return regex.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
            }
            .map { name, reading in
                SensorMetric(id: reading.key, name: name, value: reading.quantity)
            }

        let selected = coreSensors.isEmpty
            ? sensors
                .filter { name, reading in name.hasPrefix("GPU Fabric") && reading.unit.contains("C") }
                .map { name, reading in SensorMetric(id: reading.key, name: name, value: reading.quantity) }
            : coreSensors

        return selected.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}

struct TelemetryLogger {
    let logURL: URL

    private var header: String {
        [
            "timestamp",
            "cpu_temp_c",
            "gpu_temp_c",
            "chip_max_temp_c",
            "cpu_usage_percent",
            "gpu_usage_percent",
            "session_high_temp_c",
            "cpu_sensor",
            "gpu_sensor",
            "chip_max_sensor",
            "fan_id",
            "fan_mode",
            "fan_speed_rpm",
            "fan_target_rpm",
            "fan_min_rpm",
            "fan_max_rpm"
        ].joined(separator: ",")
    }

    func prepare() throws {
        if FileManager.default.fileExists(atPath: logURL.path) {
            let existing = try String(contentsOf: logURL, encoding: .utf8)
                .split(separator: "\n", maxSplits: 1)
                .first
                .map(String.init)

            if existing == header {
                return
            }

            let stamp = ISO8601DateFormatter()
                .string(from: Date())
                .replacingOccurrences(of: ":", with: "")
            let archiveURL = logURL
                .deletingLastPathComponent()
                .appendingPathComponent("temperature-log-\(stamp).csv")
            try FileManager.default.moveItem(at: logURL, to: archiveURL)
        }

        try "\(header)\n".write(to: logURL, atomically: true, encoding: .utf8)
    }

    func append(_ snapshot: TelemetrySnapshot, sessionHigh: Double) throws {
        try prepare()

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let fan = snapshot.fan
        let row = [
            formatter.string(from: snapshot.timestamp),
            String(format: "%.2f", snapshot.currentTemp),
            String(format: "%.2f", snapshot.gpuTemp),
            String(format: "%.2f", snapshot.chipMaxTemp),
            snapshot.cpuUsage.map { String(format: "%.1f", $0) } ?? "",
            snapshot.gpuUsage.map { String(format: "%.1f", $0) } ?? "",
            String(format: "%.2f", sessionHigh),
            csv(snapshot.currentSensorName),
            csv(snapshot.gpuSensorName),
            csv(snapshot.chipMaxSensorName),
            fan.map { String($0.id) } ?? "",
            fan.map { csv($0.mode) } ?? "",
            fan.map { String($0.currentRPM) } ?? "",
            fan.map { String($0.targetRPM) } ?? "",
            fan.map { String($0.minRPM) } ?? "",
            fan.map { String($0.maxRPM) } ?? ""
        ].joined(separator: ",") + "\n"

        let handle = try FileHandle(forWritingTo: logURL)
        defer { try? handle.close() }
        try handle.seekToEnd()
        if let data = row.data(using: .utf8) {
            handle.write(data)
        }
    }

    private func csv(_ value: String) -> String {
        if value.contains(",") || value.contains("\"") || value.contains("\n") {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
        }
        return value
    }
}

@MainActor
final class TelemetryModel: ObservableObject {
    @Published var samples: [TelemetrySnapshot] = []
    @Published var latest: TelemetrySnapshot?
    @Published var sessionHigh: Double = 0
    @Published var statusMessage = "Starting telemetry"
    @Published var isSampling = false
    @Published var graphMode: GraphMode = .overview
    @Published var showUsageOverlay = true

    let logURL = AppPaths.logURL()
    private let logger: TelemetryLogger
    private let usageSampler = UsageSampler()
    private var adminFallbackFailedThisLaunch = false
    private var timer: Timer?
    private let maxSamples = 240
    private let sampleInterval = 3.0

    init() {
        self.logger = TelemetryLogger(logURL: logURL)
    }

    func start() {
        guard timer == nil else { return }

        do {
            try logger.prepare()
            statusMessage = "Logging to \(logURL.lastPathComponent)"
        } catch {
            statusMessage = "Log unavailable: \(error.localizedDescription)"
        }

        sampleNow()
        timer = Timer.scheduledTimer(withTimeInterval: sampleInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.sampleNow() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func sampleNow() {
        guard !isSampling else { return }
        isSampling = true
        defer { isSampling = false }

        do {
            let backend = try Backend.locate()
            let usage = usageSampler.sample()
            let snapshot = try TelemetryReader.read(backend: backend, usage: usage)
            apply(snapshot)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func setFanMaximum() {
        runFanCommand("max", successMessage: "Maximum fan profile active")
    }

    func setFanBoost() {
        do {
            let backend = try Backend.locate()
            statusMessage = "Calculating Auto +50%"

            do {
                let result = try runBoostDirectly(backend: backend)
                statusMessage = result
                sampleNow()
                return
            } catch {
                if adminFallbackFailedThisLaunch {
                    statusMessage = "FanControl still needs helper approval. Previous admin fallback failed this launch."
                    return
                }
            }

            statusMessage = "Requesting FanControl write approval for Auto +50%"
            do {
                let output = try CommandRunner.runPrivilegedShellCommand(boostShellCommand(fanPath: backend.fanPath))
                statusMessage = output
                sampleNow()
            } catch {
                adminFallbackFailedThisLaunch = true
                statusMessage = error.localizedDescription
            }
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func returnControlToMacOS() {
        runFanCommand("auto", successMessage: "Fan control returned to macOS")
    }

    func revealLog() {
        NSWorkspace.shared.activateFileViewerSelecting([logURL])
    }

    func selectGraphMode(_ mode: GraphMode) {
        graphMode = mode
    }

    private func runFanCommand(_ argument: String, successMessage: String) {
        do {
            let backend = try Backend.locate()
            statusMessage = "Sending command to FanControl"

            do {
                let output = try CommandRunner.run(backend.fanPath, [argument])
                statusMessage = output.isEmpty ? successMessage : output
                sampleNow()
                return
            } catch {
                if adminFallbackFailedThisLaunch {
                    statusMessage = "FanControl still needs helper approval. Previous admin fallback failed this launch."
                    return
                }
            }

            statusMessage = "Requesting FanControl write approval"
            do {
                let output = try CommandRunner.runPrivilegedFanCommand(fanPath: backend.fanPath, argument: argument)
                statusMessage = output.isEmpty ? successMessage : output
                sampleNow()
            } catch {
                adminFallbackFailedThisLaunch = true
                statusMessage = error.localizedDescription
            }
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func runBoostDirectly(backend: Backend) throws -> String {
        if let fan = try readFanState(backend: backend), fan.mode.lowercased() != "auto" {
            _ = try CommandRunner.run(backend.fanPath, ["auto"])
            Thread.sleep(forTimeInterval: 1.0)
        }

        guard let autoFan = try readFanState(backend: backend) else {
            throw NSError(
                domain: "MacFanProfile.Boost",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "FanControl did not report a fan target."]
            )
        }

        let boostedRPM = boostedTarget(for: autoFan)
        _ = try CommandRunner.run(backend.fanPath, [String(boostedRPM)])
        return "Auto +50% active: \(autoFan.targetRPM) -> \(boostedRPM) RPM"
    }

    private func readFanState(backend: Backend) throws -> FanState? {
        let output = try CommandRunner.run(backend.fanPath, ["list"])
        return FanState.parse(output)
    }

    private func boostedTarget(for fan: FanState) -> Int {
        let boosted = Int((Double(fan.targetRPM) * 1.5).rounded())
        return min(fan.maxRPM, max(fan.minRPM, boosted))
    }

    private func boostShellCommand(fanPath: String) -> String {
        let fan = "'\(fanPath.replacingOccurrences(of: "'", with: "'\\''"))'"
        return """
        set -e
        \(fan) auto >/dev/null 2>&1 || true
        sleep 1
        line="$({ \(fan) list || true; } | awk 'NR > 1 && $1 ~ /^[0-9]+$/ { print; exit }')"
        auto="$(printf '%s\\n' "$line" | awk '{ print $4 }')"
        min="$(printf '%s\\n' "$line" | awk '{ print $5 }')"
        max="$(printf '%s\\n' "$line" | awk '{ print $6 }')"
        test -n "$auto" -a -n "$min" -a -n "$max"
        boost="$(awk -v auto="$auto" -v min="$min" -v max="$max" 'BEGIN { target = int((auto * 1.5) + 0.5); if (target < min) target = min; if (target > max) target = max; print target }')"
        \(fan) "$boost" >/dev/null
        printf 'Auto +50%% active: %s -> %s RPM\\n' "$auto" "$boost"
        \(fan) list
        """
    }

    private func apply(_ snapshot: TelemetrySnapshot) {
        latest = snapshot
        sessionHigh = max(sessionHigh, snapshot.currentTemp, snapshot.gpuTemp, snapshot.chipMaxTemp)
        samples.append(snapshot)
        if samples.count > maxSamples {
            samples.removeFirst(samples.count - maxSamples)
        }

        do {
            try logger.append(snapshot, sessionHigh: sessionHigh)
            statusMessage = "Last sample logged"
        } catch {
            statusMessage = "Log unavailable: \(error.localizedDescription)"
        }
    }
}

struct ContentView: View {
    @ObservedObject var model: TelemetryModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            metricRow
            graphControls
            TemperatureGraph(
                samples: model.samples,
                mode: model.graphMode,
                showUsageOverlay: model.showUsageOverlay
            )
                .frame(height: 250)
            footer
        }
        .padding(24)
        .frame(minWidth: 820, minHeight: 620)
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Mac Fan Profile")
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                Text("Thermal telemetry and macOS fan-control handoff")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            HStack(spacing: 10) {
                Button(action: model.setFanMaximum) {
                    Label("Max Fan", systemImage: "fan.fill")
                }
                .buttonStyle(.borderedProminent)

                Button(action: model.setFanBoost) {
                    Label("Auto +50%", systemImage: "gauge.medium")
                }
                .help("Set manual fan speed to 150% of the current macOS Auto target")

                Button(action: model.returnControlToMacOS) {
                    Label("macOS Control", systemImage: "arrow.triangle.2.circlepath")
                }
                .help("Return fan control to macOS automatic thermal management")

                Button(action: model.sampleNow) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
            }
            .controlSize(.large)
        }
    }

    private var metricRow: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 145), spacing: 12)], spacing: 12) {
            Button {
                model.selectGraphMode(.cpuCores)
            } label: {
                MetricBlock(
                    title: "CPU",
                    value: temp(model.latest?.currentTemp),
                    detail: usageDetail(model.latest?.cpuUsage, fallback: model.latest?.currentSensorName ?? "CPU Die Average"),
                    tint: Color(red: 0.0, green: 0.52, blue: 0.64)
                )
            }
            .buttonStyle(.plain)
            .help("Show CPU per-core temperature graph")

            Button {
                model.selectGraphMode(.gpuCores)
            } label: {
                MetricBlock(
                    title: "GPU",
                    value: temp(model.latest?.gpuTemp),
                    detail: usageDetail(model.latest?.gpuUsage, fallback: model.latest?.gpuSensorName ?? "GPU"),
                    tint: Color(red: 0.26, green: 0.55, blue: 0.30)
                )
            }
            .buttonStyle(.plain)
            .help("Show GPU sensor temperature graph")

            Button {
                model.selectGraphMode(.overview)
            } label: {
                MetricBlock(
                    title: "Chip Max",
                    value: temp(model.latest?.chipMaxTemp),
                    detail: model.latest?.chipMaxSensorName ?? "CPU Die Max",
                    tint: Color(red: 0.86, green: 0.36, blue: 0.12)
                )
            }
            .buttonStyle(.plain)
            .help("Show overview graph")

            MetricBlock(
                title: "Session High",
                value: model.sessionHigh > 0 ? temp(model.sessionHigh) : "--",
                detail: "Since app opened",
                tint: Color(red: 0.45, green: 0.35, blue: 0.68)
            )

            MetricBlock(
                title: "Fan",
                value: fanValue,
                detail: fanDetail,
                tint: Color(red: 0.42, green: 0.46, blue: 0.52)
            )
        }
    }

    private var graphControls: some View {
        HStack {
            Picker("Graph", selection: $model.graphMode) {
                ForEach(GraphMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 360)

            Toggle("Show usage %", isOn: $model.showUsageOverlay)

            Spacer()
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Image(systemName: model.isSampling ? "circle.dotted" : "checkmark.circle")
                .foregroundStyle(.secondary)
            Text(model.statusMessage)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer()

            Text(model.logURL.path)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)

            Button(action: model.revealLog) {
                Label("Reveal Log", systemImage: "doc.text.magnifyingglass")
            }
        }
        .font(.callout)
    }

    private var fanValue: String {
        guard let fan = model.latest?.fan else { return "--" }
        return "\(fan.currentRPM) RPM"
    }

    private var fanDetail: String {
        guard let fan = model.latest?.fan else { return "Fan status unavailable" }
        return "\(fan.mode), target \(fan.targetRPM)"
    }

    private func temp(_ value: Double?) -> String {
        guard let value else { return "--" }
        return String(format: "%.1f C", value)
    }

    private func usageDetail(_ value: Double?, fallback: String) -> String {
        guard let value else { return fallback }
        return String(format: "%.1f%% usage", value)
    }
}

struct MetricBlock: View {
    let title: String
    let value: String
    let detail: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle()
                    .fill(tint)
                    .frame(width: 8, height: 8)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(value)
                .font(.system(size: 28, weight: .semibold, design: .rounded))
                .minimumScaleFactor(0.75)
                .lineLimit(1)

            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
    }
}

struct PlotSeries {
    let name: String
    let values: [Double?]
    let color: Color
}

struct TemperatureGraph: View {
    let samples: [TelemetrySnapshot]
    let mode: GraphMode
    let showUsageOverlay: Bool

    private let cpuColor = Color(red: 0.0, green: 0.52, blue: 0.64)
    private let gpuColor = Color(red: 0.26, green: 0.55, blue: 0.30)
    private let maxColor = Color(red: 0.86, green: 0.36, blue: 0.12)
    private let fanColor = Color(red: 0.45, green: 0.35, blue: 0.68)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(graphTitle)
                    .font(.headline)
                Text(graphSubtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if mode == .overview {
                    legend("CPU", color: cpuColor)
                    legend("GPU", color: gpuColor)
                    legend("Chip max", color: maxColor)
                }
                if showUsageOverlay {
                    legend("Usage %", color: .secondary, dashed: true)
                }
                legend("Fan RPM", color: fanColor, dashed: true)
            }

            Canvas { context, size in
                drawGrid(context: context, size: size)
                for series in temperatureSeries() {
                    drawTemperatureLine(series: series, context: context, size: size)
                }
                if showUsageOverlay {
                    for series in usageSeries() {
                        drawUsageLine(series: series, context: context, size: size)
                    }
                }
                drawFanSpeedLine(context: context, size: size)
            }
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(nsColor: .textBackgroundColor))
            )
        }
    }

    private var graphTitle: String {
        switch mode {
        case .overview: "Temperature"
        case .cpuCores: "CPU Core Temperatures"
        case .gpuCores: "GPU Sensor Temperatures"
        }
    }

    private var graphSubtitle: String {
        switch mode {
        case .overview:
            return "CPU, GPU, chip max"
        case .cpuCores:
            return "\(latestCPUCoreNames.count) cores"
        case .gpuCores:
            return "\(latestGPUCoreNames.count) sensors"
        }
    }

    private var latestCPUCoreNames: [String] {
        samples.last?.cpuCoreTemps.map(\.name) ?? []
    }

    private var latestGPUCoreNames: [String] {
        samples.last?.gpuCoreTemps.map(\.name) ?? []
    }

    private func legend(_ label: String, color: Color, dashed: Bool = false) -> some View {
        HStack(spacing: 6) {
            Canvas { context, size in
                var path = Path()
                path.move(to: CGPoint(x: 0, y: size.height / 2))
                path.addLine(to: CGPoint(x: size.width, y: size.height / 2))
                context.stroke(
                    path,
                    with: .color(color),
                    style: StrokeStyle(lineWidth: 3, dash: dashed ? [4, 3] : [])
                )
            }
            .frame(width: 20, height: 8)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func temperatureSeries() -> [PlotSeries] {
        switch mode {
        case .overview:
            return [
                PlotSeries(name: "CPU", values: samples.map { Optional($0.currentTemp) }, color: cpuColor),
                PlotSeries(name: "GPU", values: samples.map { Optional($0.gpuTemp) }, color: gpuColor),
                PlotSeries(name: "Chip max", values: samples.map { Optional($0.chipMaxTemp) }, color: maxColor)
            ]
        case .cpuCores:
            return namedTemperatureSeries(names: latestCPUCoreNames, keyPath: \.cpuCoreTemps)
        case .gpuCores:
            return namedTemperatureSeries(names: latestGPUCoreNames, keyPath: \.gpuCoreTemps)
        }
    }

    private func namedTemperatureSeries(
        names: [String],
        keyPath: KeyPath<TelemetrySnapshot, [SensorMetric]>
    ) -> [PlotSeries] {
        names.enumerated().map { index, name in
            PlotSeries(
                name: name,
                values: samples.map { snapshot in
                    snapshot[keyPath: keyPath].first(where: { $0.name == name })?.value
                },
                color: seriesColor(index: index, total: max(names.count, 1))
            )
        }
    }

    private func usageSeries() -> [PlotSeries] {
        switch mode {
        case .overview:
            return [
                PlotSeries(name: "CPU usage", values: samples.map(\.cpuUsage), color: cpuColor.opacity(0.72)),
                PlotSeries(name: "GPU usage", values: samples.map(\.gpuUsage), color: gpuColor.opacity(0.72))
            ]
        case .cpuCores:
            let names = samples.last?.cpuCoreUsage.map(\.name) ?? []
            let perCore = names.enumerated().map { index, name in
                PlotSeries(
                    name: "\(name) usage",
                    values: samples.map { snapshot in
                        snapshot.cpuCoreUsage.first(where: { $0.name == name })?.value
                    },
                    color: seriesColor(index: index, total: max(names.count, 1)).opacity(0.65)
                )
            }
            return perCore.isEmpty
                ? [PlotSeries(name: "CPU usage", values: samples.map(\.cpuUsage), color: cpuColor.opacity(0.72))]
                : perCore
        case .gpuCores:
            return [PlotSeries(name: "GPU usage", values: samples.map(\.gpuUsage), color: gpuColor.opacity(0.72))]
        }
    }

    private func fanSpeedSeries() -> PlotSeries {
        PlotSeries(
            name: "Fan RPM",
            values: samples.map { snapshot in
                snapshot.fan.map { Double($0.currentRPM) }
            },
            color: fanColor
        )
    }

    private func fanSpeedBounds() -> (min: Double, max: Double)? {
        let fanStates = samples.compactMap(\.fan)
        guard !fanStates.isEmpty else { return nil }

        let minRPM = fanStates.map { Double($0.minRPM) }.min() ?? 0
        let maxRPM = fanStates.map { Double($0.maxRPM) }.max() ?? 1
        return (minRPM, max(maxRPM, minRPM + 1))
    }

    private func bounds() -> (min: Double, max: Double) {
        let values = temperatureSeries().flatMap { series in
            series.values.compactMap { $0 }
        }
        guard let low = values.min(), let high = values.max() else {
            return (30, 100)
        }

        let minValue = max(0, floor((low - 5) / 5) * 5)
        let maxValue = ceil((high + 5) / 5) * 5
        return (minValue, max(maxValue, minValue + 10))
    }

    private func plotArea(size: CGSize) -> CGRect {
        CGRect(x: 44, y: 14, width: max(1, size.width - 82), height: max(1, size.height - 34))
    }

    private func temperaturePoint(index: Int, count: Int, value: Double, area: CGRect, min: Double, max upper: Double) -> CGPoint {
        let xRatio = count <= 1 ? 1 : Double(index) / Double(count - 1)
        let yRatio = (value - min) / Swift.max(upper - min, 1)
        return CGPoint(
            x: area.minX + CGFloat(xRatio) * area.width,
            y: area.maxY - CGFloat(yRatio) * area.height
        )
    }

    private func usagePoint(index: Int, count: Int, value: Double, area: CGRect) -> CGPoint {
        let xRatio = count <= 1 ? 1 : Double(index) / Double(count - 1)
        let yRatio = min(100, max(0, value)) / 100
        return CGPoint(
            x: area.minX + CGFloat(xRatio) * area.width,
            y: area.maxY - CGFloat(yRatio) * area.height
        )
    }

    private func drawGrid(context: GraphicsContext, size: CGSize) {
        let area = plotArea(size: size)
        let range = bounds()

        for index in 0...4 {
            let ratio = CGFloat(index) / 4
            let y = area.maxY - ratio * area.height
            var path = Path()
            path.move(to: CGPoint(x: area.minX, y: y))
            path.addLine(to: CGPoint(x: area.maxX, y: y))
            context.stroke(path, with: .color(Color.secondary.opacity(0.18)), lineWidth: 1)

            let tempValue = range.min + Double(index) * (range.max - range.min) / 4
            context.draw(
                Text(String(format: "%.0f C", tempValue))
                    .font(.caption2)
                    .foregroundStyle(.secondary),
                at: CGPoint(x: area.minX - 8, y: y),
                anchor: .trailing
            )

            if showUsageOverlay {
                let usageValue = Double(index) * 25
                let fanText = fanSpeedBounds().map { bounds in
                    let rpm = bounds.min + Double(index) * (bounds.max - bounds.min) / 4
                    return String(format: "%.0f%% / %.0f", usageValue, rpm)
                }
                context.draw(
                    Text(fanText ?? String(format: "%.0f%%", usageValue))
                        .font(.caption2)
                        .foregroundStyle(.secondary),
                    at: CGPoint(x: area.maxX + 8, y: y),
                    anchor: .leading
                )
            } else if let fanBounds = fanSpeedBounds() {
                let fanValue = fanBounds.min + Double(index) * (fanBounds.max - fanBounds.min) / 4
                context.draw(
                    Text(String(format: "%.0f", fanValue))
                        .font(.caption2)
                        .foregroundStyle(.secondary),
                    at: CGPoint(x: area.maxX + 8, y: y),
                    anchor: .leading
                )
            }
        }

        var axis = Path()
        axis.move(to: CGPoint(x: area.minX, y: area.minY))
        axis.addLine(to: CGPoint(x: area.minX, y: area.maxY))
        axis.addLine(to: CGPoint(x: area.maxX, y: area.maxY))
        context.stroke(axis, with: .color(Color.secondary.opacity(0.28)), lineWidth: 1)
    }

    private func drawTemperatureLine(series: PlotSeries, context: GraphicsContext, size: CGSize) {
        let area = plotArea(size: size)
        let range = bounds()
        drawLine(
            values: series.values,
            color: series.color,
            style: StrokeStyle(lineWidth: mode == .overview ? 2.5 : 1.6),
            point: { index, count, value in
                temperaturePoint(index: index, count: count, value: value, area: area, min: range.min, max: range.max)
            },
            context: context
        )
    }

    private func drawUsageLine(series: PlotSeries, context: GraphicsContext, size: CGSize) {
        let area = plotArea(size: size)
        drawLine(
            values: series.values,
            color: series.color,
            style: StrokeStyle(lineWidth: mode == .cpuCores ? 1 : 2, dash: [5, 4]),
            point: { index, count, value in
                usagePoint(index: index, count: count, value: value, area: area)
            },
            context: context
        )
    }

    private func drawFanSpeedLine(context: GraphicsContext, size: CGSize) {
        guard let bounds = fanSpeedBounds() else { return }

        let area = plotArea(size: size)
        drawLine(
            values: fanSpeedSeries().values,
            color: fanColor,
            style: StrokeStyle(lineWidth: 2.2, dash: [2, 4]),
            point: { index, count, value in
                let xRatio = count <= 1 ? 1 : Double(index) / Double(count - 1)
                let yRatio = (value - bounds.min) / max(bounds.max - bounds.min, 1)
                return CGPoint(
                    x: area.minX + CGFloat(xRatio) * area.width,
                    y: area.maxY - CGFloat(min(1, max(0, yRatio))) * area.height
                )
            },
            context: context
        )
    }

    private func drawLine(
        values: [Double?],
        color: Color,
        style: StrokeStyle,
        point: (Int, Int, Double) -> CGPoint,
        context: GraphicsContext
    ) {
        guard values.compactMap({ $0 }).count > 1 else { return }

        var path = Path()
        var hasStarted = false

        for (index, value) in values.enumerated() {
            guard let value else {
                hasStarted = false
                continue
            }

            let next = point(index, values.count, value)
            if hasStarted {
                path.addLine(to: next)
            } else {
                path.move(to: next)
                hasStarted = true
            }
        }

        context.stroke(path, with: .color(color), style: style)
    }

    private func seriesColor(index: Int, total: Int) -> Color {
        Color(
            hue: Double(index) / Double(max(total, 1)),
            saturation: 0.62,
            brightness: 0.78
        )
    }
}

@main
struct MacFanProfileApp: App {
    @StateObject private var model = TelemetryModel()

    init() {
        let arguments = Set(CommandLine.arguments.dropFirst())
        if arguments.contains("--sample-once") || arguments.contains("--log-once") {
            runOneShot(log: arguments.contains("--log-once"))
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
        .windowStyle(.titleBar)
    }

    private func runOneShot(log: Bool) -> Never {
        do {
            let backend = try Backend.locate()
            let usageSampler = UsageSampler()
            _ = usageSampler.sample()
            usleep(250_000)
            let usage = usageSampler.sample()
            let snapshot = try TelemetryReader.read(backend: backend, usage: usage)
            print(
                String(
                    format: "cpu=%.2f gpu=%.2f chip_max=%.2f cpu_usage=%@ gpu_usage=%@ fan=%@",
                    snapshot.currentTemp,
                    snapshot.gpuTemp,
                    snapshot.chipMaxTemp,
                    snapshot.cpuUsage.map { String(format: "%.1f%%", $0) } ?? "--",
                    snapshot.gpuUsage.map { String(format: "%.1f%%", $0) } ?? "--",
                    snapshot.fan.map { "\($0.currentRPM) RPM" } ?? "unavailable"
                )
            )

            if log {
                let logger = TelemetryLogger(logURL: AppPaths.logURL())
                try logger.append(snapshot, sessionHigh: max(snapshot.currentTemp, snapshot.gpuTemp, snapshot.chipMaxTemp))
                print(AppPaths.logURL().path)
            }

            exit(0)
        } catch {
            fputs("\(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
}
