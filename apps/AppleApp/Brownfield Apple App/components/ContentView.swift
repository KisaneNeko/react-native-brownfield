import Brownie
import ReactBrownfield
import SwiftUI
import UIKit

struct ChatMessage: Identifiable {
    let id: Int
    let text: String
    let fromRN: Bool
}

let initialState = BrownfieldStore(
    counter: 0,
    user: User(name: "Username")
)

#if USE_EXPO_HOST
private let hostAppName = "iOS Expo"
let reactNativeModuleName = "main"
#else
private let hostAppName = "iOS Vanilla"
let reactNativeModuleName = "RNApp"
#endif

private func brownfieldPostMessageText(from raw: String) -> String {
    if let data = raw.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let text = json["text"] as? String
    {
        return text
    }
    return raw
}

var brownfieldInitialProperties: [String: Any] {
    [
        "nativeOsVersionLabel":
            "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)",
        "brownfieldE2E": ProcessInfo.processInfo.arguments.contains("-DetoxE2E"),
    ]
}

struct ContentView: View {
    @State private var messageObserver: NSObjectProtocol?
    @State private var showPostMessageToast = false
    @State private var postMessageToastText = ""
    @State private var showPopToNativeDemo = ProcessInfo.processInfo.arguments
        .contains("-BrownfieldPopToNativeDemo")
    /// Consumed once, so reopening the demo by hand does not replay the stack.
    @State private var demoAutoPushPending = ProcessInfo.processInfo.arguments
        .contains("-BrownfieldPopToNativeDemo")

    var body: some View {
        Group {
            if showPopToNativeDemo {
                if #available(iOS 16.0, *) {
                    PopToNativeStackScreen(
                        onClose: closePopToNativeDemo,
                        autoPushPath: popToNativeDemoAutoPushPath
                    )
                } else {
                    // NavigationStack is iOS 16+; without this the demo would
                    // render a blank screen with no way back.
                    VStack(spacing: 16) {
                        Text("The popToNative demo needs iOS 16 or newer.")
                            .multilineTextAlignment(.center)
                        Button("Close demo", action: closePopToNativeDemo)
                            .buttonStyle(.borderedProminent)
                    }
                    .padding()
                }
            } else {
                mainContent
            }
        }
        .onAppear {
            messageObserver = ReactNativeBrownfield.shared.onMessage { raw in
                postMessageToastText = brownfieldPostMessageText(from: raw)
                showPostMessageToast = true
            }
        }
        .onDisappear {
            if let observer = messageObserver {
                NotificationCenter.default.removeObserver(observer)
                messageObserver = nil
            }
        }
    }

    /// Launch argument builds the reporter's stack up front (issue #354), so the
    /// E2E suite never has to drive native SwiftUI controls.
    @available(iOS 16.0, *)
    private var popToNativeDemoAutoPushPath: [PopToNativeDestination] {
        demoAutoPushPending
            ? [.reactNativeFirst, .nativeMiddle, .reactNativeSecond]
            : []
    }

    private func closePopToNativeDemo() {
        showPopToNativeDemo = false
        demoAutoPushPending = false
    }

    private var mainContent: some View {
        NavigationView {
            ZStack {
                ScrollView {
                    VStack(spacing: 16) {
                        GreetingCard(name: hostAppName)

                        Button("popToNative demo") { showPopToNativeDemo = true }
                            .buttonStyle(.borderedProminent)

                        MessagesView()

                        ReactNativeView(
                            moduleName: reactNativeModuleName,
                            initialProperties: brownfieldInitialProperties
                        )
                        .navigationBarHidden(true)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .background(Color(UIColor.systemBackground))
                        .frame(minHeight: 520)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(16)
                }

                if showPostMessageToast {
                    Toast(
                        message: postMessageToastText,
                        isShowing: $showPostMessageToast
                    )
                }
            }
        }
    }
}
