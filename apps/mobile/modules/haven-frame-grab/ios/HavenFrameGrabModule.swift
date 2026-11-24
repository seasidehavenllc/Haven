import ExpoModulesCore

/// Lets the studio take a photo of an item straight from the live camera, so the stream never stops.
public class HavenFrameGrabModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HavenFrameGrab")

    OnCreate {
      HavenFrameKeeper.install()
    }

    AsyncFunction("grab") { (quality: Double) throws -> String in
      return try HavenFrameKeeper.writeLatestJpeg(quality: CGFloat(quality), maxSide: 1600, maxAge: 2.0)
    }
  }
}
