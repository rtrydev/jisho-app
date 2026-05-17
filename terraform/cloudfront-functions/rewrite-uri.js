function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // Map directory-style URIs to their index.html, matching the layout
    // emitted by `next build` with `trailingSlash: true` + `output: export`.
    if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
    } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
        // Extension-less route like `/about` → `/about/index.html`.
        request.uri = uri + '/index.html';
    }

    return request;
}
