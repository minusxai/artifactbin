/* Exercise real server/client interfaces; assertions are intentionally fatal. */
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/xpm.h>
#include <X11/extensions/XInput2.h>
#include <X11/extensions/Xrender.h>
#include <GL/gl.h>
#include <GL/glx.h>

static void extension(Display *d, const char *name) {
    int opcode, event, error;
    assert(XQueryExtension(d, name, &opcode, &event, &error));
}
int main(void) {
    Display *d = XOpenDisplay(NULL);
    assert(d);
    int screen = DefaultScreen(d), major = 2, minor = 0, ndevices = 0;
    Window root = RootWindow(d, screen);
    const char *extensions[] = {"RENDER", "XInputExtension", "GLX", "SECURITY", "Composite", "RANDR", "XTEST", "MIT-SHM"};
    for (unsigned i = 0; i < sizeof(extensions) / sizeof(extensions[0]); ++i) extension(d, extensions[i]);
    assert(XIQueryVersion(d, &major, &minor) == Success);
    XIDeviceInfo *devices = XIQueryDevice(d, XIAllDevices, &ndevices);
    assert(devices && ndevices > 0);
    XIFreeDeviceInfo(devices);

    Pixmap pix = XCreatePixmap(d, root, 4, 4, DefaultDepth(d, screen));
    GC gc = XCreateGC(d, pix, 0, NULL);
    XSetForeground(d, gc, WhitePixel(d, screen));
    XFillRectangle(d, pix, gc, 0, 0, 4, 4);
    XImage *image = XGetImage(d, pix, 0, 0, 4, 4, AllPlanes, ZPixmap);
    assert(image && XGetPixel(image, 2, 2) == WhitePixel(d, screen));
    XDestroyImage(image);
    XFreeGC(d, gc); XFreePixmap(d, pix);

    XRenderPictFormat *format = XRenderFindStandardFormat(d, PictStandardARGB32);
    assert(format);
    pix = XCreatePixmap(d, root, 4, 4, 32);
    Picture picture = XRenderCreatePicture(d, pix, format, 0, NULL);
    XRenderColor red = {65535, 0, 0, 65535};
    XRenderFillRectangle(d, PictOpSrc, picture, &red, 0, 0, 4, 4);
    image = XGetImage(d, pix, 0, 0, 4, 4, AllPlanes, ZPixmap);
    assert(image && (XGetPixel(image, 1, 1) & 0xffffffUL) == 0xff0000UL);
    XDestroyImage(image); XRenderFreePicture(d, picture); XFreePixmap(d, pix);

    char *xpm[] = {"2 2 2 1", "r c #ff0000", "b c #0000ff", "rb", "br"};
    Pixmap mask = None;
    assert(XpmCreatePixmapFromData(d, root, xpm, &pix, &mask, NULL) == XpmSuccess);
    image = XGetImage(d, pix, 0, 0, 2, 2, AllPlanes, ZPixmap);
    assert(image);
    XColor color = {.pixel = XGetPixel(image, 0, 0)};
    XQueryColor(d, DefaultColormap(d, screen), &color);
    assert(color.red == 65535 && color.green == 0 && color.blue == 0);
    XDestroyImage(image); XFreePixmap(d, pix); if (mask) XFreePixmap(d, mask);

    int attrs[] = {GLX_RGBA, GLX_RED_SIZE, 8, GLX_GREEN_SIZE, 8, GLX_BLUE_SIZE, 8, None};
    XVisualInfo *visual = glXChooseVisual(d, screen, attrs);
    assert(visual);
    XSetWindowAttributes swa = {.colormap = XCreateColormap(d, root, visual->visual, AllocNone)};
    Window window = XCreateWindow(d, root, 0, 0, 16, 16, 0, visual->depth, InputOutput,
                                  visual->visual, CWColormap, &swa);
    XMapWindow(d, window);
    XSync(d, False);
    GLXContext ctx = glXCreateContext(d, visual, NULL, True);
    assert(ctx && glXMakeCurrent(d, window, ctx));
    glClearColor(0.0, 1.0, 0.0, 1.0); glClear(GL_COLOR_BUFFER_BIT);
    unsigned char pixel[4] = {0};
    glReadPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, pixel);
    assert(glGetError() == GL_NO_ERROR && pixel[0] == 0 && pixel[1] == 255 && pixel[2] == 0);
    assert(glGetString(GL_RENDERER));
    printf("X11 drawing, XI2 %d.%d devices=%d, XRender, XPM and GLX renderer=%s PASS\n",
           major, minor, ndevices, glGetString(GL_RENDERER));
    glXMakeCurrent(d, None, NULL); glXDestroyContext(d, ctx);
    XDestroyWindow(d, window); XFreeColormap(d, swa.colormap); XFree(visual);
    XSync(d, False); XCloseDisplay(d);
    return 0;
}
