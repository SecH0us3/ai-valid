class HTMLRewriterMock {
    constructor() {
        this.selectors = [];
    }
    on(selector, handlers) {
        this.selectors.push({ selector, handlers });
        return this;
    }
    transform(response) {
        const execute = async () => {
            const htmlText = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            
            const traverse = (node) => {
                let endTagCallbacks = [];
                
                if (node.nodeType === 1) { // Element node
                    for (const { selector, handlers } of this.selectors) {
                        if (selector !== '*' && node.matches(selector)) {
                            if (handlers.element) {
                                handlers.element({
                                    getAttribute(name) {
                                        return node.getAttribute(name);
                                    },
                                    onEndTag(cb) {
                                        endTagCallbacks.push(cb);
                                    }
                                });
                            }
                        }
                    }
                }
                
                // Visit children
                for (const child of node.childNodes) {
                    traverse(child);
                }
                
                // Handle text nodes
                if (node.nodeType === 3) { // Text node
                    for (const { selector, handlers } of this.selectors) {
                        let matches = false;
                        if (selector === '*' || selector === 'body') {
                            matches = selector === '*' || !!node.parentElement?.closest('body');
                        } else if (node.parentElement && node.parentElement.matches && node.parentElement.matches(selector)) {
                            matches = true;
                        }
                        if (matches && handlers.text) {
                            if (node.nodeValue.includes('[split]')) {
                                const parts = node.nodeValue.split('[split]');
                                for (let i = 0; i < parts.length; i++) {
                                    handlers.text({
                                        text: parts[i],
                                        lastInTextNode: i === parts.length - 1
                                    });
                                }
                            } else {
                                handlers.text({
                                    text: node.nodeValue,
                                    lastInTextNode: true
                                });
                            }
                        }
                    }
                }
                
                // Trigger end tags
                if (node.nodeType === 1) {
                    for (const cb of endTagCallbacks) {
                        cb();
                    }
                }
            };
            
            traverse(doc.documentElement);
            return htmlText;
        };

        return {
            text: execute,
            arrayBuffer: async () => {
                const text = await execute();
                return new TextEncoder().encode(text).buffer;
            },
            body: {
                getReader() {
                    let done = false;
                    return {
                        read: async () => {
                            if (done) {
                                return { done: true, value: undefined };
                            }
                            done = true;
                            const text = await execute();
                            return {
                                done: false,
                                value: new TextEncoder().encode(text)
                            };
                        },
                        releaseLock() {},
                        cancel: async () => {}
                    };
                }
            }
        };
    }
}

globalThis.HTMLRewriter = HTMLRewriterMock;

export { HTMLRewriterMock };
