import { Screen } from '../utils/types';
import { useWllama } from '../utils/wllama.context';
import ScreenWrapper from './ScreenWrapper';

export default function GuideScreen() {
  const { navigateTo } = useWllama();

  return (
    <ScreenWrapper>
      <div className="guide-text pt-16">
        <h1 className="text-2xl font-bold mb-4">Wllama64 🦙</h1>

        <div className="mb-3">
          Wllama64 is a Memory64 fork of Wllama, based on{' '}
          <a
            href="https://github.com/ggerganov/llama.cpp"
            target="_blank"
            rel="noopener"
          >
            llama.cpp
          </a>
          . It enables running LLM inference directly on browser by leveraging
          the power of <b>WebAssembly</b>. It accepts GGUF as model format.
        </div>

        <div className="mb-3">
          Please note that:
          <ul>
            <li>
              Due to WebAssembly overhead, performance will not be as good as
              running llama.cpp in native. Performance degradation can range
              from 25% to 50%.
            </li>
            <li>
              The Memory64 build supports large model files without splitting.
              Compatibility mode and constrained browsers may require files
              larger than 2 GiB to be split.{' '}
              <a
                href="https://github.com/actuallymentor/wllama64?tab=readme-ov-file#split-model"
                target="_blank"
                rel="noopener"
              >
                Click here to learn more
              </a>
            </li>
            <li>
              Memory64 supports up to 16 GiB of WebAssembly memory, but models
              and their inference state must fit in available device memory.
            </li>
            <li>Running on smartphone maybe buggy.</li>
            <li>
              Browsers without shared Memory64 and JSPI support use the slower
              compatibility build, which is limited to 4 GiB.
            </li>
          </ul>
        </div>

        <div className="mb-3">
          To get started, go to{' '}
          <button
            className="btn btn-sm btn-primary btn-outline"
            onClick={() => navigateTo(Screen.MODEL)}
          >
            Manage models
          </button>{' '}
          page to select a model.
        </div>

        <h1 className="text-xl font-bold mb-4 mt-6">Reporting bugs</h1>

        <div className="mb-3">
          Wllama64 is in development and bugs may occur. If you find a bug,
          please{' '}
          <a
            href="https://github.com/actuallymentor/wllama64/issues"
            target="_blank"
            rel="noopener"
          >
            open a issue
          </a>{' '}
          with log copied from{' '}
          <button
            className="btn btn-sm btn-primary btn-outline"
            onClick={() => navigateTo(Screen.LOG)}
          >
            Debug log
          </button>
        </div>
      </div>
    </ScreenWrapper>
  );
}
