import ReactBrownfield
import SwiftUI
import UIKit

/// Reproduction for issue #354 — `popToNative` closes all React Native screens.
///
/// Mirrors the reporter's setup: a SwiftUI `NavigationStack` that interleaves
/// React Native and native destinations. Only the topmost React Native screen
/// should respond to `popToNative()`; the native screen beneath it must survive.
enum PopToNativeDestination: Hashable {
    case reactNativeFirst
    case nativeMiddle
    case reactNativeSecond
}

@available(iOS 16.0, *)
struct PopToNativeStackScreen: View {
    let onClose: () -> Void
    /// Destinations to push one after another on appear, mimicking a user
    /// navigating step by step. Pushing them sequentially matters: a
    /// pre-populated path makes SwiftUI materialize only the top destination,
    /// so buried React Native surfaces would never load.
    let autoPushPath: [PopToNativeDestination]

    @State private var path: [PopToNativeDestination] = []

    init(
        onClose: @escaping () -> Void,
        autoPushPath: [PopToNativeDestination] = []
    ) {
        self.onClose = onClose
        self.autoPushPath = autoPushPath
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            NavigationStack(path: $path) {
                ZStack {
                    Color(UIColor.systemBackground)
                        .ignoresSafeArea()

                    Text("popToNative demo root")
                }
                .navigationBarHidden(true)
                .navigationDestination(for: PopToNativeDestination.self) { destination in
                    destinationView(for: destination)
                }
            }

            controls
                .padding(16)
        }
        .task {
            for (index, destination) in autoPushPath.enumerated() {
                path.append(destination)

                // No need to wait after the last push.
                guard index < autoPushPath.count - 1 else { break }

                // `try?` swallows the CancellationError, so check explicitly —
                // otherwise a cancelled sequence appends the remaining
                // destinations back-to-back.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if Task.isCancelled { return }
            }
        }
    }

    @ViewBuilder
    private func destinationView(for destination: PopToNativeDestination) -> some View {
        switch destination {
        case .reactNativeFirst:
            reactNativeSurface(tag: "first")

        case .reactNativeSecond:
            reactNativeSurface(tag: "second")

        case .nativeMiddle:
            PopToNativeMiddleScreen()
        }
    }

    /// `surfaceTag` lets the E2E suite address a specific React Native surface
    /// while several are mounted at once.
    private func reactNativeSurface(tag: String) -> some View {
        var properties = brownfieldInitialProperties
        properties["surfaceTag"] = tag

        return ReactNativeView(
            moduleName: reactNativeModuleName,
            initialProperties: properties
        )
        .ignoresSafeArea()
        .navigationBarHidden(true)
    }

    private var controls: some View {
        VStack(alignment: .trailing, spacing: 8) {
            Button("Push RN") { path.append(nextReactNativeDestination) }

            Button("Push native") { path.append(.nativeMiddle) }

            // Same entry point the TurboModule calls for `popToNative()` from JS
            // (see RCT_EXPORT_METHOD(popToNative:) in ReactNativeBrownfieldModule.mm).
            Button("Pop to native") {
                ReactNativeBrownfieldModuleImpl.popToNative(animated: false)
            }

            Button("Close demo", action: onClose)
        }
        .buttonStyle(.borderedProminent)
    }

    /// Alternates so a second "Push RN" lands a distinct destination on the stack.
    private var nextReactNativeDestination: PopToNativeDestination {
        path.contains(.reactNativeFirst) ? .reactNativeSecond : .reactNativeFirst
    }
}

private struct PopToNativeMiddleScreen: View {
    var body: some View {
        ZStack {
            Color(UIColor.systemBackground)
                .ignoresSafeArea()

            // A plain Text stays its own accessibility element, so Detox can
            // match it by label. `.accessibilityElement()` would hide it.
            Text("Native middle screen")
                .font(.title3)
        }
        .navigationBarHidden(true)
    }
}
