// What an iPhone does for a native window's page itself (`Device` in mod.rs): its picker, the pop-up menu a `<select>`
// opens in Safari, from a button over the picker's box; its share sheet; its document scanner; its haptics; its text
// size; and a tap on its status bar.

#include <string>

#import <PhotosUI/PhotosUI.h>
#import <UIKit/UIKit.h>
#import <VisionKit/VisionKit.h>

typedef void (*DevicePicked)(void* context, int64_t node, const char* value);

// A button over a picker's box whose menu is the picker, which goes as its menu does.
@interface OnePicker : UIButton
@end

@implementation OnePicker
- (void)contextMenuInteraction:(UIContextMenuInteraction*)interaction
       willEndForConfiguration:(UIContextMenuConfiguration*)configuration
                      animator:(id<UIContextMenuInteractionAnimating>)animator {
  [super contextMenuInteraction:interaction willEndForConfiguration:configuration animator:animator];
  [animator addCompletion:^{
    [self removeFromSuperview];
  }];
}
@end

// Shows the picker for picker node `node` of the window `context` over `view`, at its box (in points), of `options`
// (JSON: each its `value`, `label` and whether it's `disabled`), `chosen` the one chosen or NULL. What's chosen goes to
// `picked`. → whether it showed.
extern "C" bool device_pick(UIView* view, double x, double y, double width, double height, const char* options, const char* chosen, void* context, int64_t node, DevicePicked picked) {
  NSData* json = [NSData dataWithBytes:options length:strlen(options)];
  NSArray* all = [NSJSONSerialization JSONObjectWithData:json options:0 error:nil];
  if (![all isKindOfClass:[NSArray class]]) return false;
  NSString* now = chosen ? [NSString stringWithUTF8String:chosen] : nil;
  NSMutableArray<UIMenuElement*>* actions = [NSMutableArray array];
  for (NSDictionary* option in all) {
    if (![option isKindOfClass:[NSDictionary class]]) continue;
    NSString* value = [option[@"value"] description];
    NSString* label = [option[@"label"] isKindOfClass:[NSString class]] ? option[@"label"] : value;
    std::string held = value.UTF8String;
    UIAction* action = [UIAction actionWithTitle:label image:nil identifier:nil handler:^(UIAction*) {
      picked(context, node, held.c_str());
    }];
    if ([value isEqualToString:now]) action.state = UIMenuElementStateOn;
    if ([option[@"disabled"] boolValue]) action.attributes = UIMenuElementAttributesDisabled;
    [actions addObject:action];
  }
  OnePicker* button = [OnePicker buttonWithType:UIButtonTypeCustom];
  button.frame = CGRectMake(x, y, width, height);
  button.menu = [UIMenu menuWithTitle:@"" image:nil identifier:nil options:UIMenuOptionsSingleSelection children:actions];
  button.showsMenuAsPrimaryAction = YES;
  [view addSubview:button];
  if (@available(iOS 17.4, *)) {
    [button performPrimaryAction];
    return true;
  }
  [button removeFromSuperview];
  return false;
}

// The share sheet for `text`, over `view`'s window.
extern "C" bool device_share(UIView* view, const char* text) {
  UIViewController* over = view.window.rootViewController;
  while (over.presentedViewController) over = over.presentedViewController;
  if (!over) return false;
  UIActivityViewController* sheet = [[UIActivityViewController alloc] initWithActivityItems:@[ [NSString stringWithUTF8String:text] ] applicationActivities:nil];
  sheet.popoverPresentationController.sourceView = view;
  [over presentViewController:sheet animated:YES completion:nil];
  return true;
}

typedef void (*DeviceScanned)(void* context, const char* files);

// What shows a document scanner and hears what it scanned (`device_scan`): VisionKit's, which finds each page's edges,
// takes it by itself and flattens it, as Notes' does.
@interface OneScanner : NSObject <VNDocumentCameraViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate, PHPickerViewControllerDelegate>
@property(nonatomic) void* context;
@property(nonatomic) DeviceScanned scanned;
@end

// The scanner that's showing, which holds itself until it has said what was scanned.
static OneScanner* scanning;

@implementation OneScanner
// Tells what was scanned: a JPEG file (quality 90) of each page in a folder of its own, as a JSON array of their paths, none
// if it was cancelled.
- (void)finish:(NSArray<UIImage*>*)images {
  NSString* folder = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSUUID UUID].UUIDString];
  [[NSFileManager defaultManager] createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:nil];
  NSMutableArray<NSString*>* paths = [NSMutableArray array];
  for (UIImage* image in images) {
    NSString* path = [folder stringByAppendingPathComponent:[NSString stringWithFormat:@"scan-%lu.jpg", (unsigned long)paths.count + 1]];
    if ([UIImageJPEGRepresentation(image, 0.9) writeToFile:path atomically:YES]) [paths addObject:path];
  }
  NSData* json = [NSJSONSerialization dataWithJSONObject:paths options:0 error:nil];
  std::string told((const char*)json.bytes, json.length);
  OneScanner* me = self;
  scanning = nil;
  me.scanned(me.context, told.c_str());
}
- (void)documentCameraViewController:(VNDocumentCameraViewController*)controller didFinishWithScan:(VNDocumentCameraScan*)scan {
  NSMutableArray<UIImage*>* images = [NSMutableArray array];
  for (NSUInteger page = 0; page < scan.pageCount; page++) [images addObject:[scan imageOfPageAtIndex:page]];
  [controller dismissViewControllerAnimated:YES completion:^{
    [self finish:images];
  }];
}
- (void)documentCameraViewControllerDidCancel:(VNDocumentCameraViewController*)controller {
  [controller dismissViewControllerAnimated:YES completion:^{
    [self finish:@[]];
  }];
}
- (void)documentCameraViewController:(VNDocumentCameraViewController*)controller didFailWithError:(NSError*)error {
  [controller dismissViewControllerAnimated:YES completion:^{
    [self finish:@[]];
  }];
}
// Without a scanner (the simulator, an old iPhone), a photo from the camera.
- (void)imagePickerController:(UIImagePickerController*)picker didFinishPickingMediaWithInfo:(NSDictionary<UIImagePickerControllerInfoKey, id>*)info {
  UIImage* image = info[UIImagePickerControllerOriginalImage];
  [picker dismissViewControllerAnimated:YES completion:^{
    [self finish:image ? @[ image ] : @[]];
  }];
}
- (void)imagePickerControllerDidCancel:(UIImagePickerController*)picker {
  [picker dismissViewControllerAnimated:YES completion:^{
    [self finish:@[]];
  }];
}
// Without a camera either, photos chosen from the library, in the order they were chosen.
- (void)picker:(PHPickerViewController*)picker didFinishPicking:(NSArray<PHPickerResult*>*)results {
  NSMutableArray* loaded = [NSMutableArray array];
  dispatch_group_t group = dispatch_group_create();
  for (PHPickerResult* result in results) {
    NSUInteger at = loaded.count;
    [loaded addObject:[NSNull null]];
    dispatch_group_enter(group);
    [result.itemProvider loadObjectOfClass:[UIImage class] completionHandler:^(__kindof id<NSItemProviderReading> image, NSError*) {
      if ([image isKindOfClass:[UIImage class]]) loaded[at] = image;
      dispatch_group_leave(group);
    }];
  }
  [picker dismissViewControllerAnimated:YES completion:^{
    dispatch_group_notify(group, dispatch_get_main_queue(), ^{
      NSMutableArray<UIImage*>* images = [NSMutableArray array];
      for (id image in loaded) if ([image isKindOfClass:[UIImage class]]) [images addObject:image];
      [self finish:images];
    });
  }];
}
@end

// The document scanner over `view`'s window: VisionKit's where there is one, else the camera's photo, else the photo
// library's. What it scanned goes to `scanned` as a JSON array of the paths of JPEG files, once it's shown and closed.
// → whether it showed.
extern "C" bool device_scan(UIView* view, void* context, DeviceScanned scanned) {
  UIViewController* over = view.window.rootViewController;
  while (over.presentedViewController) over = over.presentedViewController;
  if (!over || scanning) return false;
  OneScanner* scanner = [[OneScanner alloc] init];
  scanner.context = context;
  scanner.scanned = scanned;
  UIViewController* shown;
  if ([VNDocumentCameraViewController isSupported]) {
    VNDocumentCameraViewController* camera = [[VNDocumentCameraViewController alloc] init];
    camera.delegate = scanner;
    shown = camera;
  } else if ([UIImagePickerController isSourceTypeAvailable:UIImagePickerControllerSourceTypeCamera]) {
    UIImagePickerController* camera = [[UIImagePickerController alloc] init];
    camera.sourceType = UIImagePickerControllerSourceTypeCamera;
    camera.delegate = scanner;
    shown = camera;
  } else {
    PHPickerConfiguration* configuration = [[PHPickerConfiguration alloc] init];
    configuration.filter = [PHPickerFilter imagesFilter];
    configuration.selectionLimit = 0;
    configuration.selection = PHPickerConfigurationSelectionOrdered;
    PHPickerViewController* library = [[PHPickerViewController alloc] initWithConfiguration:configuration];
    library.delegate = scanner;
    shown = library;
  }
  scanning = scanner;
  [over presentViewController:shown animated:YES completion:nil];
  return true;
}

// A haptic, by its name: an impact's style, a selection, or a notification's outcome. → whether there's one by it.
extern "C" bool device_haptic(const char* kind) {
  NSString* named = [NSString stringWithUTF8String:kind];
  NSDictionary<NSString*, NSNumber*>* impacts = @{
    @"light" : @(UIImpactFeedbackStyleLight),
    @"medium" : @(UIImpactFeedbackStyleMedium),
    @"heavy" : @(UIImpactFeedbackStyleHeavy),
    @"rigid" : @(UIImpactFeedbackStyleRigid),
    @"soft" : @(UIImpactFeedbackStyleSoft),
  };
  NSDictionary<NSString*, NSNumber*>* outcomes = @{
    @"success" : @(UINotificationFeedbackTypeSuccess),
    @"warning" : @(UINotificationFeedbackTypeWarning),
    @"error" : @(UINotificationFeedbackTypeError),
  };
  if (impacts[named]) {
    [[[UIImpactFeedbackGenerator alloc] initWithStyle:(UIImpactFeedbackStyle)impacts[named].integerValue] impactOccurred];
  } else if (outcomes[named]) {
    [[[UINotificationFeedbackGenerator alloc] init] notificationOccurred:(UINotificationFeedbackType)outcomes[named].integerValue];
  } else if ([named isEqualToString:@"selection"]) {
    [[[UISelectionFeedbackGenerator alloc] init] selectionChanged];
  } else {
    return false;
  }
  return true;
}

// The text size its person chose (Dynamic Type), as its body text's size in points.
extern "C" double device_text_size() {
  return [UIFont preferredFontForTextStyle:UIFontTextStyleBody].pointSize;
}

typedef void (*DeviceTapped)(void* context);

// A scroll view a point high along a window's top, which iOS asks as its status bar is tapped (`scrollsToTop`): it
// says no, and tells the window, whose page scrolls to its top itself.
@interface OneStatusBar : UIScrollView <UIScrollViewDelegate>
@property(nonatomic) void* context;
@property(nonatomic) DeviceTapped tapped;
@end

@implementation OneStatusBar
- (BOOL)scrollViewShouldScrollToTop:(UIScrollView*)scrollView {
  self.tapped(self.context);
  return NO;
}
@end

extern "C" void device_status_bar(UIView* view, void* context, DeviceTapped tapped) {
  OneStatusBar* bar = [[OneStatusBar alloc] initWithFrame:CGRectMake(0, 0, view.bounds.size.width, 1)];
  bar.autoresizingMask = UIViewAutoresizingFlexibleWidth;
  bar.contentSize = CGSizeMake(view.bounds.size.width, 3);
  bar.contentOffset = CGPointMake(0, 1);
  bar.scrollsToTop = YES;
  bar.context = context;
  bar.tapped = tapped;
  bar.delegate = bar;
  [view addSubview:bar];
}
