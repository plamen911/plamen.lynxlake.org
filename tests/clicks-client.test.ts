// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { trackClicks } from '../src/chat/client/clicks';

// A fresh document per test, so listeners do not pile up across tests.
let doc: Document;
let send: Mock<(key: string) => void>;

beforeEach(() => {
  doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = '<a id="cv" data-click="cv" href="#"><span id="inner">CV</span></a><a id="plain" href="#">Plain</a>';
  send = vi.fn<(key: string) => void>();
  trackClicks(doc, send);
});

const fire = (id: string, type: string, button = 0): void => {
  doc.getElementById(id)!.dispatchEvent(new MouseEvent(type, { bubbles: true, button }));
};

describe('trackClicks', () => {
  it('reports a click on a marked link, or on something inside it', () => {
    fire('cv', 'click');
    fire('inner', 'click');
    expect(send.mock.calls).toEqual([['cv'], ['cv']]);
  });

  it('reports links added after it started', () => {
    doc.body.insertAdjacentHTML('beforeend', '<a id="late" data-click="email" href="#">Mail</a>');
    fire('late', 'click');
    expect(send).toHaveBeenCalledWith('email');
  });

  it('reports a middle click but not a right click', () => {
    fire('cv', 'auxclick', 1);
    fire('cv', 'auxclick', 2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('ignores unmarked links', () => {
    fire('plain', 'click');
    expect(send).not.toHaveBeenCalled();
  });
});
