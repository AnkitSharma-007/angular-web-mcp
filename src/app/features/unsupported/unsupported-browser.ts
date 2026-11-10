import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { describeBrowser } from './detect-browser';

@Component({
  selector: 'app-root',
  templateUrl: './unsupported-browser.html',
  host: { class: 'block' },
})
export class UnsupportedBrowser {
  protected readonly detected = describeBrowser(
    inject(DOCUMENT).defaultView?.navigator.userAgent ?? '',
  );
}
